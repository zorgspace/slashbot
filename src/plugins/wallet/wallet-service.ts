/**
 * wallet/wallet-service.ts — Stateful wallet operations encapsulated in the WalletService class.
 *
 * Manages encrypted wallet file I/O, session lifecycle, balance queries, transfers,
 * credit redemption, exchange rates, usage tracking, proxy URL resolution, and settings.
 *
 * Depends on: types.ts (schemas/constants), crypto.ts, solana.ts, pricing.ts, proxy-auth.ts.
 */
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonValue } from '../../plugin-sdk/index.js';

import {
  PLUGIN_ID,
  SESSION_DURATION_MS,
  DEFAULT_PROXY_BASE_URL,
  WalletDataSchema,
  WalletSettingsSchema,
} from './types.js';

import type {
  WalletData,
  WalletSettings,
  LegacyWalletConfig,
  PaymentMode,
  SessionKeypair,
  WalletBalances,
  ExchangeRates,
} from './types.js';

import { encryptBytes, decryptBytes, decryptLegacySecret, encodeBase58, decodeBase58 } from './crypto.js';
import {
  TREASURY_ADDRESS,
  getBalances,
  getSolBalance,
  getSlashbotBalance,
  getMaxSendableSol,
  sendSol,
  sendSlashbot,
  isValidAddress,
} from './solana.js';
import {
  parseAmountArg,
  fetchExchangeRates as fetchExchangeRatesRaw,
  getModelPricing,
  calculateBaseUsdCost,
  usdToSol,
  usdToSlashbot,
} from './pricing.js';
import { getSessionAuthHeaders } from './proxy-auth.js';

import type { TokenType } from './solana.js';

// ── Stateless helpers ───────────────────────────────────────────────────

export function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asTokenType(value: unknown): TokenType {
  if (value === 'sol' || value === 'slashbot') return value;
  throw new Error('token must be "sol" or "slashbot"');
}

// ── WalletService ───────────────────────────────────────────────────────

export class WalletService {
  private _walletPath: string;
  private _walletSettingsPath: string;
  private _homeDir: string;

  private sessionKeypair: SessionKeypair | null = null;
  private sessionExpiryMs = 0;
  private _paymentMode: PaymentMode = 'apikey';
  private ratesCache: { rates: ExchangeRates | null } = { rates: null };

  constructor(walletPath: string, walletSettingsPath: string, homeDir: string) {
    this._walletPath = walletPath;
    this._walletSettingsPath = walletSettingsPath;
    this._homeDir = homeDir;
  }

  get walletPath(): string { return this._walletPath; }
  get walletSettingsPath(): string { return this._walletSettingsPath; }
  get homeDir(): string { return this._homeDir; }
  get paymentMode(): PaymentMode { return this._paymentMode; }
  set paymentMode(mode: PaymentMode) { this._paymentMode = mode; }

  // ── Settings I/O ────────────────────────────────────────────────────

  async readSettings(): Promise<WalletSettings> {
    try {
      const raw = await fs.readFile(this._walletSettingsPath, 'utf8');
      const result = WalletSettingsSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : { paymentMode: 'apikey' };
    } catch {
      return { paymentMode: 'apikey' };
    }
  }

  async saveSettings(next: Partial<WalletSettings>): Promise<WalletSettings> {
    const current = await this.readSettings();
    const merged: WalletSettings = {
      paymentMode: next.paymentMode === 'token' ? 'token' : next.paymentMode === 'apikey' ? 'apikey' : current.paymentMode,
      proxyBaseUrl: next.proxyBaseUrl === undefined ? current.proxyBaseUrl : next.proxyBaseUrl,
    };
    await fs.mkdir(this._homeDir, { recursive: true });
    await fs.writeFile(this._walletSettingsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    this._paymentMode = merged.paymentMode;
    return merged;
  }

  // ── Wallet file I/O ─────────────────────────────────────────────────

  async walletExists(): Promise<boolean> {
    try {
      await fs.access(this._walletPath);
      return true;
    } catch {
      return false;
    }
  }

  async readWallet(): Promise<WalletData | null> {
    try {
      const raw = await fs.readFile(this._walletPath, 'utf8');
      const result = WalletDataSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async saveWallet(data: WalletData): Promise<void> {
    await fs.mkdir(this._homeDir, { recursive: true });
    await fs.writeFile(this._walletPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  // ── Decrypt wallet secret ───────────────────────────────────────────

  private async decryptWalletSecret(wallet: WalletData, password: string): Promise<Uint8Array> {
    if (wallet.encryptedKey && wallet.authTag) {
      return decryptBytes(password, wallet.encryptedKey, wallet.iv, wallet.salt, wallet.authTag);
    }

    if (wallet.encryptedSecret) {
      const b58 = decryptLegacySecret(wallet.encryptedSecret, password, wallet.salt, wallet.iv);
      return decodeBase58(b58);
    }

    throw new Error('wallet file is missing encrypted key data');
  }

  // ── Keypair unlock ──────────────────────────────────────────────────

  async unlockKeypair(password: string): Promise<SessionKeypair | null> {
    const wallet = await this.readWallet();
    if (!wallet) return null;

    try {
      const { Keypair } = await import('@solana/web3.js');
      const secretKey = await this.decryptWalletSecret(wallet, password);
      const keypair = Keypair.fromSecretKey(secretKey);
      return {
        publicKey: keypair.publicKey.toBase58(),
        secretKey: keypair.secretKey,
      };
    } catch {
      return null;
    }
  }

  // ── Session management ──────────────────────────────────────────────

  clearSession(): void {
    this.sessionKeypair = null;
    this.sessionExpiryMs = 0;
  }

  isSessionActive(): boolean {
    if (!this.sessionKeypair) return false;
    if (Date.now() >= this.sessionExpiryMs) {
      this.clearSession();
      return false;
    }
    return true;
  }

  async unlockSession(password: string): Promise<boolean> {
    const keypair = await this.unlockKeypair(password);
    if (!keypair) return false;
    this.sessionKeypair = keypair;
    this.sessionExpiryMs = Date.now() + SESSION_DURATION_MS;
    return true;
  }

  refreshSessionExpiry(): void {
    if (this.sessionKeypair) {
      this.sessionExpiryMs = Date.now() + SESSION_DURATION_MS;
    }
  }

  getActiveSessionKeypair(): SessionKeypair | null {
    return this.isSessionActive() ? this.sessionKeypair : null;
  }

  getSessionAuthHeaders(body?: string): Record<string, string> | null {
    if (!this.isSessionActive() || !this.sessionKeypair) {
      return null;
    }

    this.sessionExpiryMs = Date.now() + SESSION_DURATION_MS;
    return getSessionAuthHeaders(this.sessionKeypair, body);
  }

  // ── Wallet creation / import / export ───────────────────────────────

  async createWallet(password: string): Promise<{ publicKey: string; seedPhrase: string }> {
    const { generateMnemonic, mnemonicToSeedSync } = await import('bip39');
    const { derivePath } = await import('ed25519-hd-key');
    const { Keypair } = await import('@solana/web3.js');

    const seedPhrase = generateMnemonic();
    const seed = mnemonicToSeedSync(seedPhrase);
    const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    const keypair = Keypair.fromSeed(key);

    const encryptedSecret = encryptBytes(password, keypair.secretKey);
    const encryptedSeed = encryptBytes(password, new TextEncoder().encode(seedPhrase));

    await this.saveWallet({
      version: 1,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      encryptedKey: encryptedSecret.encryptedKey,
      iv: encryptedSecret.iv,
      salt: encryptedSecret.salt,
      authTag: encryptedSecret.authTag,
      encryptedSeed: encryptedSeed.encryptedKey,
      seedIv: encryptedSeed.iv,
      seedSalt: encryptedSeed.salt,
      seedAuthTag: encryptedSeed.authTag,
    });

    return {
      publicKey: keypair.publicKey.toBase58(),
      seedPhrase,
    };
  }

  async importWalletFromPrivateKey(privateKeyBase58: string, password: string): Promise<{ publicKey: string }> {
    const { Keypair } = await import('@solana/web3.js');
    const secretKey = await decodeBase58(privateKeyBase58.trim());
    const keypair = Keypair.fromSecretKey(secretKey);

    const encryptedSecret = encryptBytes(password, keypair.secretKey);

    await this.saveWallet({
      version: 1,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      encryptedKey: encryptedSecret.encryptedKey,
      iv: encryptedSecret.iv,
      salt: encryptedSecret.salt,
      authTag: encryptedSecret.authTag,
    });

    return { publicKey: keypair.publicKey.toBase58() };
  }

  async importWalletFromSeed(seedPhrase: string, password: string, accountIndex = 0): Promise<{ publicKey: string }> {
    const { validateMnemonic, mnemonicToSeedSync } = await import('bip39');
    const { derivePath } = await import('ed25519-hd-key');
    const { Keypair } = await import('@solana/web3.js');

    const normalized = seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(normalized)) {
      throw new Error('invalid seed phrase');
    }

    const seed = mnemonicToSeedSync(normalized);
    const { key } = derivePath(`m/44'/501'/${accountIndex}'/0'`, seed.toString('hex'));
    const keypair = Keypair.fromSeed(key);

    const encryptedSecret = encryptBytes(password, keypair.secretKey);
    const encryptedSeed = encryptBytes(password, new TextEncoder().encode(normalized));

    await this.saveWallet({
      version: 1,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      encryptedKey: encryptedSecret.encryptedKey,
      iv: encryptedSecret.iv,
      salt: encryptedSecret.salt,
      authTag: encryptedSecret.authTag,
      encryptedSeed: encryptedSeed.encryptedKey,
      seedIv: encryptedSeed.iv,
      seedSalt: encryptedSeed.salt,
      seedAuthTag: encryptedSeed.authTag,
    });

    return { publicKey: keypair.publicKey.toBase58() };
  }

  async exportPrivateKey(password: string): Promise<string | null> {
    const keypair = await this.unlockKeypair(password);
    if (!keypair) return null;
    return encodeBase58(keypair.secretKey);
  }

  async exportSeedPhrase(password: string): Promise<string | null> {
    const wallet = await this.readWallet();
    if (!wallet) return null;

    if (!wallet.encryptedSeed || !wallet.seedIv || !wallet.seedSalt || !wallet.seedAuthTag) {
      return null;
    }

    try {
      const bytes = decryptBytes(
        password,
        wallet.encryptedSeed,
        wallet.seedIv,
        wallet.seedSalt,
        wallet.seedAuthTag,
      );
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  async hasSeedPhrase(): Promise<boolean> {
    const wallet = await this.readWallet();
    return !!(wallet?.encryptedSeed && wallet.seedIv && wallet.seedSalt && wallet.seedAuthTag);
  }

  // ── Balance queries ─────────────────────────────────────────────────

  async getBalances(publicKeyB58: string): Promise<WalletBalances> {
    return getBalances(publicKeyB58);
  }

  async getSolBalance(publicKeyB58: string): Promise<number> {
    return getSolBalance(publicKeyB58);
  }

  async getSlashbotBalance(publicKeyB58: string): Promise<number> {
    return getSlashbotBalance(publicKeyB58);
  }

  // ── Transfer operations ─────────────────────────────────────────────

  private async resolveSigningKeypair(password?: string): Promise<SessionKeypair | null> {
    if (this.isSessionActive() && this.sessionKeypair) {
      return this.sessionKeypair;
    }

    if (password) {
      return this.unlockKeypair(password);
    }

    return null;
  }

  private async resolveTransferAmount(token: TokenType, fromAddress: string, toAddress: string, amountArg: string): Promise<number> {
    const parsed = parseAmountArg(amountArg);
    if (!parsed.all) return parsed.value;

    if (token === 'sol') {
      return getMaxSendableSol(fromAddress, toAddress);
    }

    return getSlashbotBalance(fromAddress);
  }

  async sendToken(token: TokenType, toAddress: string, amountArg: string, password?: string): Promise<{ signature: string; amount: number }> {
    const wallet = await this.readWallet();
    if (!wallet) throw new Error('no wallet configured');

    const signing = await this.resolveSigningKeypair(password);
    if (!signing) throw new Error('wallet session not active; use /solana unlock <password> or pass a password');

    if (!(await isValidAddress(toAddress))) {
      throw new Error('invalid destination address');
    }

    const amount = await this.resolveTransferAmount(token, wallet.publicKey, toAddress, amountArg);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('insufficient balance to send requested amount');
    }

    const signature = token === 'sol'
      ? await sendSol(toAddress, amount, signing.secretKey)
      : await sendSlashbot(toAddress, amount, signing.secretKey);

    return { signature, amount };
  }

  // ── Credit operations ───────────────────────────────────────────────

  async redeemCredits(amountArg: string, password?: string): Promise<{ signature: string; creditsAwarded?: number; newBalance?: number; amount: number }> {
    const transfer = await this.sendToken('slashbot', TREASURY_ADDRESS, amountArg, password);

    const wallet = await this.readWallet();
    if (!wallet) {
      return { signature: transfer.signature, amount: transfer.amount };
    }

    const proxyBaseUrl = this.resolveProxyBaseUrl(await this.readSettings());

    try {
      const response = await fetch(`${proxyBaseUrl}/api/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: wallet.publicKey,
          transaction_signature: transfer.signature,
          token_type: 'SLASHBOT',
        }),
      });

      if (!response.ok) {
        return { signature: transfer.signature, amount: transfer.amount };
      }

      const payload = await response.json() as { creditsAwarded?: number; newBalance?: number };
      return {
        signature: transfer.signature,
        amount: transfer.amount,
        creditsAwarded: payload.creditsAwarded,
        newBalance: payload.newBalance,
      };
    } catch {
      return { signature: transfer.signature, amount: transfer.amount };
    }
  }

  async getCreditBalance(publicKey: string): Promise<number | null> {
    const proxyBaseUrl = this.resolveProxyBaseUrl(await this.readSettings());
    try {
      const response = await fetch(`${proxyBaseUrl}/api/credits?wallet=${encodeURIComponent(publicKey)}`);
      if (!response.ok) return null;
      const payload = await response.json() as { credits?: number };
      return typeof payload.credits === 'number' ? payload.credits : null;
    } catch {
      return null;
    }
  }

  // ── Exchange rates ──────────────────────────────────────────────────

  async fetchExchangeRates(forceRefresh = false): Promise<ExchangeRates> {
    return fetchExchangeRatesRaw(forceRefresh, this.ratesCache);
  }

  // ── Proxy URL resolution ────────────────────────────────────────────

  resolveProxyBaseUrl(saved: WalletSettings): string {
    const legacyCandidates = [
      join(process.cwd(), '.slashbot', 'wallet-config.json'),
      join(this._homeDir, 'wallet-config.json'),
    ];

    let legacyProxyUrl: string | undefined;
    for (const configPath of legacyCandidates) {
      try {
        if (!existsSync(configPath)) continue;
        const raw = readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as LegacyWalletConfig;
        const candidate = asOptionalString(parsed.proxyUrl);
        if (candidate) {
          legacyProxyUrl = candidate;
          break;
        }
      } catch {
        // Ignore malformed or unreadable legacy config.
      }
    }

    return (
      process.env.SLASHBOT_PROXY_URL
      ?? process.env.PROXY_BASE_URL
      ?? saved.proxyBaseUrl
      ?? legacyProxyUrl
      ?? DEFAULT_PROXY_BASE_URL
    );
  }

  // ── Usage tracking ──────────────────────────────────────────────────

  async fetchUsage(
    type: 'summary' | 'stats' | 'history',
    options: { period?: string; limit?: number } = {},
  ): Promise<JsonValue> {
    const wallet = await this.readWallet();
    if (!wallet) {
      throw new Error('no wallet configured');
    }

    if (!this.isSessionActive()) {
      throw new Error('wallet session is not active; run /solana unlock <password>');
    }

    const params = new URLSearchParams({ type });
    if (options.period) params.set('period', options.period);
    if (options.limit) params.set('limit', String(options.limit));

    const proxyBaseUrl = this.resolveProxyBaseUrl(await this.readSettings());
    const headers = {
      'Content-Type': 'application/json',
      ...(this.getSessionAuthHeaders() ?? {}),
    };

    const response = await fetch(`${proxyBaseUrl}/api/usage?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    }

    return await response.json() as JsonValue;
  }
}
