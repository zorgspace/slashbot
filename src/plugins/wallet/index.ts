import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, pbkdf2Sync, randomBytes, scryptSync, sign } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { JsonValue, PathResolver, SlashbotPlugin } from '@slashbot/plugin-sdk';
import type { TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/index.js';
import { asObject, asString } from '../utils.js';

const WalletDataSchema = z.object({
  version: z.literal(1).optional(),
  publicKey: z.string(),
  createdAt: z.string().optional(),
  encryptedKey: z.string().optional(),
  iv: z.string(),
  salt: z.string(),
  authTag: z.string().optional(),
  encryptedSeed: z.string().optional(),
  seedIv: z.string().optional(),
  seedSalt: z.string().optional(),
  seedAuthTag: z.string().optional(),
  encryptedSecret: z.string().optional(),
  mnemonic: z.string().optional(),
});

const WalletSettingsSchema = z.object({
  paymentMode: z.enum(['apikey', 'token']).default('apikey'),
  proxyBaseUrl: z.string().optional(),
});

const PLUGIN_ID = 'slashbot.wallet';
const SESSION_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_PROXY_BASE_URL = 'https://getslashbot.com';
const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const SLASHBOT_TOKEN_MINT = 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS';
const TREASURY_ADDRESS = 'DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7';
const TOKEN_DECIMALS = 9;

type TokenType = 'sol' | 'slashbot';
type PaymentMode = 'apikey' | 'token';

interface WalletData {
  version?: 1;
  publicKey: string;
  createdAt?: string;
  encryptedKey?: string;
  iv: string;
  salt: string;
  authTag?: string;
  encryptedSeed?: string;
  seedIv?: string;
  seedSalt?: string;
  seedAuthTag?: string;

  // Legacy wallet format compatibility.
  encryptedSecret?: string;
  mnemonic?: string;
}

interface WalletSettings {
  paymentMode: PaymentMode;
  proxyBaseUrl?: string;
}

interface LegacyWalletConfig {
  proxyUrl?: string;
}

interface SessionKeypair {
  publicKey: string;
  secretKey: Uint8Array;
}

interface WalletBalances {
  sol: number;
  slashbot: number;
}

interface ExchangeRates {
  solUsd: number;
  slashbotSol: number;
  updatedAt: number;
}

interface ModelPricing {
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

const XAI_MODEL_PRICING: ModelPricing[] = [
  {
    model: 'grok-4.1-fast-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  {
    model: 'grok-4-1-fast-non-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  {
    model: 'grok-code-fast-1',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.5,
  },
];

const DEFAULT_MODEL_PRICING: ModelPricing = {
  model: 'default',
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 3.0,
};

let _walletPath = '';
let _walletSettingsPath = '';
let _homeDir = '';

function walletPath(): string {
  return _walletPath;
}

function walletSettingsPath(): string {
  return _walletSettingsPath;
}


function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asTokenType(value: unknown): TokenType {
  if (value === 'sol' || value === 'slashbot') return value;
  throw new Error('token must be "sol" or "slashbot"');
}

function formatNumber(num: number, decimals = 6): string {
  if (!Number.isFinite(num)) return '0';
  if (num === 0) return '0';
  if (Math.abs(num) < 0.000001) return num.toExponential(2);
  if (Math.abs(num) < 1) return num.toFixed(decimals);
  if (Math.abs(num) < 1000) return num.toFixed(Math.min(6, decimals));
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function parseAmountArg(raw: string | undefined): { all: boolean; value: number } {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'all' || value === 'max') {
    return { all: true, value: 0 };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('amount must be a positive number, "all", or "max"');
  }
  return { all: false, value: parsed };
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
}

function encryptBytes(password: string, plaintext: Uint8Array): { encryptedKey: string; iv: string; salt: string; authTag: string } {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptBytes(password: string, encryptedKey: string, iv: string, salt: string, authTag: string): Uint8Array {
  const key = deriveKey(password, Buffer.from(salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'base64')),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

// Backward compatibility with slashbot3's previous AES-CBC wallet format.
function decryptLegacySecret(encryptedHex: string, password: string, saltHex: string, ivHex: string): string {
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function getModelPricing(model: string): ModelPricing {
  const exact = XAI_MODEL_PRICING.find((entry) => entry.model === model);
  if (exact) return exact;

  const lower = model.toLowerCase();
  const partial = XAI_MODEL_PRICING.find(
    (entry) => entry.model.toLowerCase().includes(lower) || lower.includes(entry.model.toLowerCase())
  );
  if (partial) {
    return { ...partial, model };
  }

  return { ...DEFAULT_MODEL_PRICING, model };
}

function calculateBaseUsdCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return inputCost + outputCost;
}

function resolveProxyBaseUrl(saved: WalletSettings): string {
  const legacyCandidates = [
    join(process.cwd(), '.slashbot', 'wallet-config.json'),
    join(_homeDir, 'wallet-config.json'),
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

/**
 * Wallet plugin — Solana wallet management with transfers, pricing, and token-mode usage tracking.
 *
 * Manages an encrypted Solana keypair (BIP39 seed or raw private key) with
 * AES-256-GCM encryption. Supports SOL and SLASHBOT token transfers, credit
 * redemption, exchange rate tracking (CoinGecko/Jupiter/DexScreener), and
 * token-mode proxy authentication for LLM requests (Ed25519 signatures).
 *
 * Tools:
 *  - `wallet.status` — Get wallet existence, public key, balances (SOL + SLASHBOT), credits, and payment mode.
 *  - `wallet.send`   — Send SOL or SLASHBOT tokens to an address (requires approval).
 *  - `wallet.redeem`  — Redeem SLASHBOT tokens for API credits via treasury transfer (requires approval).
 *
 * Commands:
 *  - `/solana create <password>`                              — Create a new BIP39 wallet.
 *  - `/solana import <private-key> <password>`                — Import from base58 private key.
 *  - `/solana import seed <password> <seed phrase...>`        — Import from seed phrase.
 *  - `/solana export <password>`                              — Export private key (base58).
 *  - `/solana export seed <password>`                         — Export seed phrase.
 *  - `/solana balance`                                        — Show SOL, SLASHBOT, and credit balances.
 *  - `/solana send <sol|slashbot> <address> <amount> [pw]`    — Transfer tokens.
 *  - `/solana redeem <amount> [password]`                     — Redeem SLASHBOT for credits.
 *  - `/solana deposit`                                        — Show deposit instructions.
 *  - `/solana pricing [model|models]`                         — Show model pricing and exchange rates.
 *  - `/solana mode [apikey|token] [password]`                 — Get or switch payment mode.
 *  - `/solana usage [stats|history|models]`                   — Show usage stats (token mode only).
 *  - `/solana unlock <password>`                              — Unlock wallet session (30 min).
 *  - `/solana lock`                                           — Lock wallet session.
 *  - `/solana status`                                         — Full payment mode status.
 *
 * Services:
 *  - `wallet.proxyAuth` — TokenModeProxyAuthService for signing LLM proxy requests.
 */
export function createWalletPlugin(): SlashbotPlugin {
  let sessionKeypair: SessionKeypair | null = null;
  let sessionExpiryMs = 0;
  let paymentMode: PaymentMode = 'apikey';
  let cachedRates: ExchangeRates | null = null;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Wallet',
      version: '0.2.0',
      main: 'bundled',
      description: 'Solana wallet management with transfers, pricing, and token-mode usage tracking',
    },
    setup: async (context) => {
      const paths = context.getService<PathResolver>('kernel.paths')!;
      _homeDir = paths.home();
      _walletPath = paths.home('wallet.json');
      _walletSettingsPath = paths.home('wallet-settings.json');

      async function readSettings(): Promise<WalletSettings> {
        try {
          const raw = await fs.readFile(walletSettingsPath(), 'utf8');
          const result = WalletSettingsSchema.safeParse(JSON.parse(raw));
          return result.success ? result.data : { paymentMode: 'apikey' };
        } catch {
          return { paymentMode: 'apikey' };
        }
      }

      async function saveSettings(next: Partial<WalletSettings>): Promise<WalletSettings> {
        const current = await readSettings();
        const merged: WalletSettings = {
          paymentMode: next.paymentMode === 'token' ? 'token' : next.paymentMode === 'apikey' ? 'apikey' : current.paymentMode,
          proxyBaseUrl: next.proxyBaseUrl === undefined ? current.proxyBaseUrl : next.proxyBaseUrl,
        };
        await fs.mkdir(_homeDir, { recursive: true });
        await fs.writeFile(walletSettingsPath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
        paymentMode = merged.paymentMode;
        return merged;
      }

      async function walletExists(): Promise<boolean> {
        try {
          await fs.access(walletPath());
          return true;
        } catch {
          return false;
        }
      }

      async function readWallet(): Promise<WalletData | null> {
        try {
          const raw = await fs.readFile(walletPath(), 'utf8');
          const result = WalletDataSchema.safeParse(JSON.parse(raw));
          return result.success ? result.data : null;
        } catch {
          return null;
        }
      }

      async function saveWallet(data: WalletData): Promise<void> {
        await fs.mkdir(_homeDir, { recursive: true });
        await fs.writeFile(walletPath(), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }

      async function encodeBase58(bytes: Uint8Array): Promise<string> {
        const mod = await import('bs58');
        const bs58 = (mod as { default?: { encode: (value: Uint8Array) => string } }).default ?? (mod as unknown as { encode: (value: Uint8Array) => string });
        return bs58.encode(bytes);
      }

      async function decodeBase58(value: string): Promise<Uint8Array> {
        const mod = await import('bs58');
        const bs58 = (mod as { default?: { decode: (input: string) => Uint8Array } }).default ?? (mod as unknown as { decode: (input: string) => Uint8Array });
        return bs58.decode(value);
      }

      async function decryptWalletSecret(wallet: WalletData, password: string): Promise<Uint8Array> {
        if (wallet.encryptedKey && wallet.authTag) {
          return decryptBytes(password, wallet.encryptedKey, wallet.iv, wallet.salt, wallet.authTag);
        }

        if (wallet.encryptedSecret) {
          const b58 = decryptLegacySecret(wallet.encryptedSecret, password, wallet.salt, wallet.iv);
          return decodeBase58(b58);
        }

        throw new Error('wallet file is missing encrypted key data');
      }

      async function unlockKeypair(password: string): Promise<SessionKeypair | null> {
        const wallet = await readWallet();
        if (!wallet) return null;

        try {
          const { Keypair } = await import('@solana/web3.js');
          const secretKey = await decryptWalletSecret(wallet, password);
          const keypair = Keypair.fromSecretKey(secretKey);
          return {
            publicKey: keypair.publicKey.toBase58(),
            secretKey: keypair.secretKey,
          };
        } catch {
          return null;
        }
      }

      function clearSession(): void {
        sessionKeypair = null;
        sessionExpiryMs = 0;
      }

      function isSessionActive(): boolean {
        if (!sessionKeypair) return false;
        if (Date.now() >= sessionExpiryMs) {
          clearSession();
          return false;
        }
        return true;
      }

      async function unlockSession(password: string): Promise<boolean> {
        const keypair = await unlockKeypair(password);
        if (!keypair) return false;
        sessionKeypair = keypair;
        sessionExpiryMs = Date.now() + SESSION_DURATION_MS;
        return true;
      }

      function getSessionAuthHeaders(body?: string): Record<string, string> | null {
        if (!isSessionActive() || !sessionKeypair) {
          return null;
        }

        sessionExpiryMs = Date.now() + SESSION_DURATION_MS;
        const timestamp = Date.now();
        const bodyHash = body ? createHash('sha256').update(body).digest('hex') : undefined;
        const message = bodyHash
          ? `slashbot:${sessionKeypair.publicKey}:${timestamp}:${bodyHash}`
          : `slashbot:${sessionKeypair.publicKey}:${timestamp}`;

        const privateKey = createPrivateKey({
          key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            Buffer.from(sessionKeypair.secretKey.slice(0, 32)),
          ]),
          format: 'der',
          type: 'pkcs8',
        });

        const signature = sign(null, Buffer.from(message), privateKey).toString('base64');

        const headers: Record<string, string> = {
          'X-Wallet-Address': sessionKeypair.publicKey,
          'X-Wallet-Signature': signature,
          'X-Wallet-Timestamp': String(timestamp),
        };

        if (bodyHash) {
          headers['X-Body-Hash'] = bodyHash;
        }

        return headers;
      }

      async function createWallet(password: string): Promise<{ publicKey: string; seedPhrase: string }> {
        const { generateMnemonic, mnemonicToSeedSync } = await import('bip39');
        const { derivePath } = await import('ed25519-hd-key');
        const { Keypair } = await import('@solana/web3.js');

        const seedPhrase = generateMnemonic();
        const seed = mnemonicToSeedSync(seedPhrase);
        const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
        const keypair = Keypair.fromSeed(key);

        const encryptedSecret = encryptBytes(password, keypair.secretKey);
        const encryptedSeed = encryptBytes(password, new TextEncoder().encode(seedPhrase));

        await saveWallet({
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

      async function importWalletFromPrivateKey(privateKeyBase58: string, password: string): Promise<{ publicKey: string }> {
        const { Keypair } = await import('@solana/web3.js');
        const secretKey = await decodeBase58(privateKeyBase58.trim());
        const keypair = Keypair.fromSecretKey(secretKey);

        const encryptedSecret = encryptBytes(password, keypair.secretKey);

        await saveWallet({
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

      async function importWalletFromSeed(seedPhrase: string, password: string, accountIndex = 0): Promise<{ publicKey: string }> {
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

        await saveWallet({
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

      async function exportPrivateKey(password: string): Promise<string | null> {
        const keypair = await unlockKeypair(password);
        if (!keypair) return null;
        return encodeBase58(keypair.secretKey);
      }

      async function exportSeedPhrase(password: string): Promise<string | null> {
        const wallet = await readWallet();
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

      async function hasSeedPhrase(): Promise<boolean> {
        const wallet = await readWallet();
        return !!(wallet?.encryptedSeed && wallet.seedIv && wallet.seedSalt && wallet.seedAuthTag);
      }

      async function isValidAddress(address: string): Promise<boolean> {
        try {
          const { PublicKey } = await import('@solana/web3.js');
          // eslint-disable-next-line no-new
          new PublicKey(address);
          return true;
        } catch {
          return false;
        }
      }

      async function getConnection() {
        const { Connection } = await import('@solana/web3.js');
        const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
        return new Connection(rpcUrl, 'confirmed');
      }

      async function getSolBalance(publicKeyB58: string): Promise<number> {
        const { PublicKey } = await import('@solana/web3.js');
        const connection = await getConnection();
        const lamports = await connection.getBalance(new PublicKey(publicKeyB58));
        return lamports / 1e9;
      }

      async function getSlashbotBalance(publicKeyB58: string): Promise<number> {
        const { PublicKey, Keypair } = await import('@solana/web3.js');
        const spl = await import('@solana/spl-token') as unknown as {
          Token: {
            getAssociatedTokenAddress: (...args: unknown[]) => Promise<unknown>;
            new(connection: unknown, mint: unknown, programId: unknown, payer: unknown): {
              getAccountInfo: (address: unknown) => Promise<{ amount: bigint | string | number }>;
            };
          };
          ASSOCIATED_TOKEN_PROGRAM_ID: unknown;
          TOKEN_PROGRAM_ID: unknown;
        };

        const connection = await getConnection();
        const owner = new PublicKey(publicKeyB58);
        const mint = new PublicKey(SLASHBOT_TOKEN_MINT);

        try {
          const ata = await spl.Token.getAssociatedTokenAddress(
            spl.ASSOCIATED_TOKEN_PROGRAM_ID,
            spl.TOKEN_PROGRAM_ID,
            mint,
            owner,
          );
          const tokenClient = new spl.Token(connection, mint, spl.TOKEN_PROGRAM_ID, Keypair.generate());
          const account = await tokenClient.getAccountInfo(ata);
          const raw = typeof account.amount === 'bigint' ? Number(account.amount) : Number(String(account.amount));
          return raw / 10 ** TOKEN_DECIMALS;
        } catch {
          return 0;
        }
      }

      async function getBalances(publicKeyB58: string): Promise<WalletBalances> {
        const [sol, slashbot] = await Promise.all([
          getSolBalance(publicKeyB58),
          getSlashbotBalance(publicKeyB58),
        ]);
        return { sol, slashbot };
      }

      async function estimateSolTransferFee(fromAddress: string, toAddress: string): Promise<number> {
        const { PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
        const connection = await getConnection();

        const fromPubkey = new PublicKey(fromAddress);
        const toPubkey = new PublicKey(toAddress);

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports: 1,
          }),
        );

        const latest = await connection.getLatestBlockhash();
        tx.recentBlockhash = latest.blockhash;
        tx.feePayer = fromPubkey;

        const fee = await connection.getFeeForMessage(tx.compileMessage());
        const lamports = typeof fee.value === 'number' ? fee.value : 5_000;
        return lamports / 1e9;
      }

      async function getMaxSendableSol(fromAddress: string, toAddress: string): Promise<number> {
        const [balance, fee] = await Promise.all([
          getSolBalance(fromAddress),
          estimateSolTransferFee(fromAddress, toAddress),
        ]);
        const max = balance - fee;
        return max > 0 ? max : 0;
      }

      async function resolveSigningKeypair(password?: string): Promise<SessionKeypair | null> {
        if (isSessionActive() && sessionKeypair) {
          return sessionKeypair;
        }

        if (password) {
          return unlockKeypair(password);
        }

        return null;
      }

      async function sendSol(toAddress: string, amount: number, password?: string): Promise<string> {
        const signing = await resolveSigningKeypair(password);
        if (!signing) throw new Error('wallet session not active; use /solana unlock <password> or pass a password');

        const { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
        const connection = await getConnection();
        const from = Keypair.fromSecretKey(signing.secretKey);

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: from.publicKey,
            toPubkey: new PublicKey(toAddress),
            lamports: Math.floor(amount * 1e9),
          }),
        );

        return sendAndConfirmTransaction(connection, tx, [from]);
      }

      async function sendSlashbot(toAddress: string, amount: number, password?: string): Promise<string> {
        const signing = await resolveSigningKeypair(password);
        if (!signing) throw new Error('wallet session not active; use /solana unlock <password> or pass a password');

        const { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
        const spl = await import('@solana/spl-token') as unknown as {
          Token: {
            getAssociatedTokenAddress: (...args: unknown[]) => Promise<unknown>;
            createAssociatedTokenAccountInstruction: (...args: unknown[]) => unknown;
            createTransferInstruction: (...args: unknown[]) => unknown;
            new(connection: unknown, mint: unknown, programId: unknown, payer: unknown): {
              getAccountInfo: (address: unknown) => Promise<{ amount: bigint | string | number }>;
            };
          };
          ASSOCIATED_TOKEN_PROGRAM_ID: unknown;
          TOKEN_PROGRAM_ID: unknown;
        };

        const connection = await getConnection();
        const sender = Keypair.fromSecretKey(signing.secretKey);
        const mint = new PublicKey(SLASHBOT_TOKEN_MINT);
        const recipient = new PublicKey(toAddress);

        const sourceAta = await spl.Token.getAssociatedTokenAddress(
          spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          spl.TOKEN_PROGRAM_ID,
          mint,
          sender.publicKey,
        );

        const tokenClient = new spl.Token(connection, mint, spl.TOKEN_PROGRAM_ID, sender);
        const sourceAccount = await tokenClient.getAccountInfo(sourceAta);
        const sourceRaw = typeof sourceAccount.amount === 'bigint' ? Number(sourceAccount.amount) : Number(String(sourceAccount.amount));
        const neededRaw = Math.floor(amount * 10 ** TOKEN_DECIMALS);

        if (sourceRaw < neededRaw) {
          throw new Error(`insufficient SLASHBOT balance: ${sourceRaw / 10 ** TOKEN_DECIMALS} available`);
        }

        const destAta = await spl.Token.getAssociatedTokenAddress(
          spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          spl.TOKEN_PROGRAM_ID,
          mint,
          recipient,
        );

        const tx = new Transaction();

        try {
          await tokenClient.getAccountInfo(destAta);
        } catch {
          tx.add(
            spl.Token.createAssociatedTokenAccountInstruction(
              spl.ASSOCIATED_TOKEN_PROGRAM_ID,
              spl.TOKEN_PROGRAM_ID,
              mint,
              destAta,
              recipient,
              sender.publicKey,
            ) as never,
          );
        }

        tx.add(
          spl.Token.createTransferInstruction(
            spl.TOKEN_PROGRAM_ID,
            sourceAta,
            destAta,
            sender.publicKey,
            [],
            neededRaw,
          ) as never,
        );

        return sendAndConfirmTransaction(connection, tx, [sender]);
      }

      async function resolveTransferAmount(token: TokenType, fromAddress: string, toAddress: string, amountArg: string): Promise<number> {
        const parsed = parseAmountArg(amountArg);
        if (!parsed.all) return parsed.value;

        if (token === 'sol') {
          return getMaxSendableSol(fromAddress, toAddress);
        }

        return getSlashbotBalance(fromAddress);
      }

      async function sendToken(token: TokenType, toAddress: string, amountArg: string, password?: string): Promise<{ signature: string; amount: number }> {
        const wallet = await readWallet();
        if (!wallet) throw new Error('no wallet configured');

        if (!(await isValidAddress(toAddress))) {
          throw new Error('invalid destination address');
        }

        const amount = await resolveTransferAmount(token, wallet.publicKey, toAddress, amountArg);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('insufficient balance to send requested amount');
        }

        const signature = token === 'sol'
          ? await sendSol(toAddress, amount, password)
          : await sendSlashbot(toAddress, amount, password);

        return { signature, amount };
      }

      async function redeemCredits(amountArg: string, password?: string): Promise<{ signature: string; creditsAwarded?: number; newBalance?: number; amount: number }> {
        const transfer = await sendToken('slashbot', TREASURY_ADDRESS, amountArg, password);

        const wallet = await readWallet();
        if (!wallet) {
          return { signature: transfer.signature, amount: transfer.amount };
        }

        const proxyBaseUrl = resolveProxyBaseUrl(await readSettings());

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

      async function getCreditBalance(publicKey: string): Promise<number | null> {
        const proxyBaseUrl = resolveProxyBaseUrl(await readSettings());
        try {
          const response = await fetch(`${proxyBaseUrl}/api/credits?wallet=${encodeURIComponent(publicKey)}`);
          if (!response.ok) return null;
          const payload = await response.json() as { credits?: number };
          return typeof payload.credits === 'number' ? payload.credits : null;
        } catch {
          return null;
        }
      }

      async function fetchSolUsdPrice(): Promise<number> {
        try {
          const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error(String(response.status));
          const data = await response.json() as { solana?: { usd?: number } };
          if (!data.solana?.usd) throw new Error('missing sol price');
          return data.solana.usd;
        } catch {
          return 150;
        }
      }

      async function fetchSlashbotSolPrice(): Promise<number> {
        const solMint = 'So11111111111111111111111111111111111111112';

        try {
          const response = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${solMint}&outputMint=${SLASHBOT_TOKEN_MINT}&amount=1000000000&slippageBps=50`,
            { headers: { Accept: 'application/json' } },
          );

          if (response.ok) {
            const data = await response.json() as { outAmount?: string; error?: string };
            if (!data.error && data.outAmount) {
              const slashbotPerSol = Number(data.outAmount) / 1e9;
              if (slashbotPerSol > 0) {
                return 1 / slashbotPerSol;
              }
            }
          }
        } catch {
          // continue fallback chain
        }

        try {
          const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SLASHBOT_TOKEN_MINT}`, {
            headers: { Accept: 'application/json' },
          });

          if (response.ok) {
            const data = await response.json() as {
              pairs?: Array<{ priceNative?: string; priceUsd?: string }>;
            };

            const firstPair = data.pairs?.[0];
            if (firstPair?.priceNative) {
              const parsed = Number(firstPair.priceNative);
              if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
              }
            }

            if (firstPair?.priceUsd) {
              const solUsd = await fetchSolUsdPrice();
              const usd = Number(firstPair.priceUsd);
              if (Number.isFinite(usd) && usd > 0 && solUsd > 0) {
                return usd / solUsd;
              }
            }
          }
        } catch {
          // continue fallback chain
        }

        return 0.000001;
      }

      async function fetchExchangeRates(forceRefresh = false): Promise<ExchangeRates> {
        const now = Date.now();

        if (!forceRefresh && cachedRates && now - cachedRates.updatedAt < 60_000) {
          return cachedRates;
        }

        const [solUsd, slashbotSol] = await Promise.all([
          fetchSolUsdPrice(),
          fetchSlashbotSolPrice(),
        ]);

        cachedRates = { solUsd, slashbotSol, updatedAt: now };
        return cachedRates;
      }

      function usdToSol(usd: number, solUsdPrice: number): number {
        return usd / solUsdPrice;
      }

      function solToSlashbot(sol: number, slashbotSolPrice: number): number {
        return sol / slashbotSolPrice;
      }

      function usdToSlashbot(usd: number, solUsdPrice: number, slashbotSolPrice: number): number {
        return solToSlashbot(usdToSol(usd, solUsdPrice), slashbotSolPrice);
      }

      async function fetchUsage(
        type: 'summary' | 'stats' | 'history',
        options: { period?: string; limit?: number } = {},
      ): Promise<JsonValue> {
        const wallet = await readWallet();
        if (!wallet) {
          throw new Error('no wallet configured');
        }

        if (!isSessionActive()) {
          throw new Error('wallet session is not active; run /solana unlock <password>');
        }

        const params = new URLSearchParams({ type });
        if (options.period) params.set('period', options.period);
        if (options.limit) params.set('limit', String(options.limit));

        const proxyBaseUrl = resolveProxyBaseUrl(await readSettings());
        const headers = {
          'Content-Type': 'application/json',
          ...(getSessionAuthHeaders() ?? {}),
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

      paymentMode = (await readSettings()).paymentMode;

      const tokenModeProxyAuth: TokenModeProxyAuthService = {
        resolveProxyRequest: async (requestBody: string) => {
          const settings = await readSettings();
          paymentMode = settings.paymentMode;

          if (settings.paymentMode !== 'token') {
            return { enabled: false };
          }

          const wallet = await readWallet();
          if (!wallet) {
            return {
              enabled: false,
              reason: 'Token mode is enabled but no wallet is configured. Run: solana create or solana import.',
            };
          }

          if (!isSessionActive()) {
            return {
              enabled: false,
              reason: 'Token mode is enabled but wallet session is locked. Run: solana unlock <password>.',
            };
          }

          const headers = getSessionAuthHeaders(requestBody);
          if (!headers) {
            return {
              enabled: false,
              reason: 'Token mode is enabled but wallet session expired. Run: solana unlock <password>.',
            };
          }

          const baseRoot = resolveProxyBaseUrl(settings).replace(/\/+$/, '');
          return {
            enabled: true,
            baseUrl: `${baseRoot}/api/grok`,
            headers,
          };
        },
      };

      context.registerService({
        id: 'wallet.proxyAuth',
        pluginId: PLUGIN_ID,
        description: 'Token-mode proxy auth resolver for LLM requests',
        implementation: tokenModeProxyAuth,
      });

      // ── Tools ───────────────────────────────────────────────────────

      context.registerTool({
        id: 'wallet.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get wallet status, balances, and payment mode. Args: {}',
        execute: async () => {
          try {
            const exists = await walletExists();
            if (!exists) {
              return {
                ok: true,
                output: {
                  exists: false,
                  mode: paymentMode,
                  message: 'No wallet found. Use /solana create or /solana import.',
                } as unknown as JsonValue,
              };
            }

            const wallet = await readWallet();
            if (!wallet) {
              return { ok: false, error: { code: 'WALLET_READ_ERROR', message: 'Failed to parse wallet file' } };
            }

            const [balances, credits, settings] = await Promise.all([
              getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
              getCreditBalance(wallet.publicKey),
              readSettings(),
            ]);

            return {
              ok: true,
              output: {
                exists: true,
                publicKey: wallet.publicKey,
                balance: balances,
                credits,
                sessionActive: isSessionActive(),
                mode: settings.paymentMode,
                proxyBaseUrl: resolveProxyBaseUrl(settings),
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'WALLET_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'wallet.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send SOL or SLASHBOT. Args: { token?: "sol"|"slashbot", to: string, amount: number|string, password?: string }',
        requiresApproval: true,
        execute: async (args) => {
          try {
            const input = asObject(args);
            const token = input.token ? asTokenType(asString(input.token, 'token')) : 'sol';
            const to = asString(input.to, 'to');
            const amount = typeof input.amount === 'number' ? String(input.amount) : asString(input.amount, 'amount');
            const password = asOptionalString(input.password);

            const result = await sendToken(token, to, amount, password);
            return {
              ok: true,
              output: {
                token,
                to,
                amount: result.amount,
                signature: result.signature,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'wallet.redeem',
        title: 'Redeem',
        pluginId: PLUGIN_ID,
        description: 'Redeem SLASHBOT to credits via treasury transfer. Args: { amount: number|string, password?: string }',
        requiresApproval: true,
        execute: async (args) => {
          try {
            const input = asObject(args);
            const amount = typeof input.amount === 'number' ? String(input.amount) : asString(input.amount, 'amount');
            const password = asOptionalString(input.password);
            const result = await redeemCredits(amount, password);
            return {
              ok: true,
              output: {
                amount: result.amount,
                signature: result.signature,
                creditsAwarded: result.creditsAwarded,
                newBalance: result.newBalance,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'REDEEM_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ────────────────────────────────────────────────────

      async function executeSolanaCommand(args: string[], commandContext: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream }): Promise<number> {
        const sub = args[0]?.toLowerCase() ?? 'overview';

        if (sub === 'create') {
          if (await walletExists()) {
            commandContext.stdout.write(`Wallet already exists at ${walletPath()}\n`);
            return 1;
          }

          const password = args[1];
          if (!password || password.length < 8) {
            commandContext.stderr.write('Usage: solana create <password>  (password min length: 8)\n');
            return 1;
          }

          try {
            const created = await createWallet(password);
            commandContext.stdout.write(
              `Wallet created\nAddress: ${created.publicKey}\nPath: ${walletPath()}\nSeed phrase (backup now): ${created.seedPhrase}\n`,
            );
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Failed to create wallet: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'import') {
          if (await walletExists()) {
            commandContext.stderr.write(`Wallet already exists at ${walletPath()}\n`);
            return 1;
          }

          const importType = args[1]?.toLowerCase();
          if (!importType) {
            commandContext.stderr.write('Usage: solana import <base58-private-key> <password>\n       solana import seed <password> <seed phrase...> [accountIndex]\n');
            return 1;
          }

          if (importType === 'seed') {
            const password = args[2];
            if (!password || password.length < 8) {
              commandContext.stderr.write('Usage: solana import seed <password> <seed phrase...> [accountIndex]\n');
              return 1;
            }

            const maybeIndex = args[args.length - 1];
            const parsedIndex = Number(maybeIndex);
            const hasIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0;
            const seedParts = args.slice(3, hasIndex ? -1 : undefined);
            const seedPhrase = seedParts.join(' ').trim();
            if (!seedPhrase) {
              commandContext.stderr.write('Missing seed phrase.\n');
              return 1;
            }

            try {
              const imported = await importWalletFromSeed(seedPhrase, password, hasIndex ? parsedIndex : 0);
              commandContext.stdout.write(`Wallet imported from seed\nAddress: ${imported.publicKey}\nPath: m/44'/501'/${hasIndex ? parsedIndex : 0}'/0'\n`);
              return 0;
            } catch (err) {
              commandContext.stderr.write(`Failed to import seed wallet: ${String(err)}\n`);
              return 1;
            }
          }

          const privateKey = args[1];
          const password = args[2];
          if (!privateKey || !password || password.length < 8) {
            commandContext.stderr.write('Usage: solana import <base58-private-key> <password>\n');
            return 1;
          }

          try {
            const imported = await importWalletFromPrivateKey(privateKey, password);
            commandContext.stdout.write(`Wallet imported\nAddress: ${imported.publicKey}\n`);
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Failed to import wallet: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'export') {
          if (!(await walletExists())) {
            commandContext.stderr.write('No wallet found. Use: solana create\n');
            return 1;
          }

          const target = args[1]?.toLowerCase();
          if (target === 'seed') {
            const password = args[2];
            if (!password) {
              commandContext.stderr.write('Usage: solana export seed <password>\n');
              return 1;
            }

            if (!(await hasSeedPhrase())) {
              commandContext.stderr.write('This wallet does not have a stored seed phrase (private-key import).\n');
              return 1;
            }

            const phrase = await exportSeedPhrase(password);
            if (!phrase) {
              commandContext.stderr.write('Failed to export seed phrase (invalid password?).\n');
              return 1;
            }

            commandContext.stdout.write(`Seed phrase:\n${phrase}\n`);
            return 0;
          }

          const password = target ?? args[2];
          if (!password) {
            commandContext.stderr.write('Usage: solana export <password>\n       solana export seed <password>\n');
            return 1;
          }

          const privateKey = await exportPrivateKey(password);
          if (!privateKey) {
            commandContext.stderr.write('Failed to export private key (invalid password?).\n');
            return 1;
          }

          commandContext.stdout.write(`Private key (base58):\n${privateKey}\n`);
          return 0;
        }

        if (sub === 'unlock') {
          if (!(await walletExists())) {
            commandContext.stderr.write('No wallet found. Use: solana create\n');
            return 1;
          }

          const password = args[1];
          if (!password) {
            commandContext.stderr.write('Usage: solana unlock <password>\n');
            return 1;
          }

          const ok = await unlockSession(password);
          commandContext.stdout.write(ok ? 'Wallet unlocked (session active for 30 minutes).\n' : 'Failed to unlock wallet.\n');
          return ok ? 0 : 1;
        }

        if (sub === 'lock') {
          clearSession();
          commandContext.stdout.write('Wallet session locked.\n');
          return 0;
        }

        if (sub === 'balance') {
          const wallet = await readWallet();
          if (!wallet) {
            commandContext.stderr.write('No wallet found. Use: solana create\n');
            return 1;
          }

          const [balances, credits] = await Promise.all([
            getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
            getCreditBalance(wallet.publicKey),
          ]);

          commandContext.stdout.write(
            `Address: ${wallet.publicKey}\nSOL: ${formatNumber(balances.sol, 9)}\nSLASHBOT: ${formatNumber(balances.slashbot, 4)}\nCredits: ${credits === null ? '(proxy unavailable)' : credits}\n`,
          );
          return 0;
        }

        if (sub === 'send') {
          const token = args[1]?.toLowerCase();
          const toAddress = args[2];
          const amount = args[3];
          const password = args[4];

          if (!token || !toAddress || !amount) {
            commandContext.stderr.write('Usage: solana send <sol|slashbot> <address> <amount|all|max> [password]\n');
            return 1;
          }

          if (token !== 'sol' && token !== 'slashbot') {
            commandContext.stderr.write('Token type must be sol or slashbot.\n');
            return 1;
          }

          try {
            const sent = await sendToken(token, toAddress, amount, password);
            commandContext.stdout.write(
              `Sent ${formatNumber(sent.amount, token === 'sol' ? 9 : 4)} ${token.toUpperCase()} to ${toAddress}\nSignature: ${sent.signature}\n`,
            );
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Send failed: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'redeem') {
          const amount = args[1];
          const password = args[2];
          if (!amount) {
            commandContext.stderr.write('Usage: solana redeem <amount|all|max> [password]\n');
            return 1;
          }

          try {
            const result = await redeemCredits(amount, password);
            commandContext.stdout.write(
              `Redeemed ${formatNumber(result.amount, 4)} SLASHBOT\nTx: ${result.signature}\nCredits awarded: ${result.creditsAwarded ?? '(unknown)'}\nNew credit balance: ${result.newBalance ?? '(unknown)'}\n`,
            );
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Redeem failed: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'deposit') {
          const wallet = await readWallet();
          commandContext.stdout.write(
            `Deposit instructions\n${wallet ? `Your wallet: ${wallet.publicKey}\n` : ''}Treasury: ${TREASURY_ADDRESS}\n1. Receive SLASHBOT in your wallet\n2. Run: solana redeem <amount>\n`,
          );
          return 0;
        }

        if (sub === 'pricing') {
          const modelArg = args[1];

          if (modelArg === 'models') {
            commandContext.stdout.write('Available models (USD per 1M tokens, x5 display multiplier)\n');
            for (const model of XAI_MODEL_PRICING) {
              const input = (model.inputPricePerMillion * 5).toFixed(2);
              const output = (model.outputPricePerMillion * 5).toFixed(2);
              commandContext.stdout.write(`- ${model.model}: input $${input}, output $${output}\n`);
            }
            return 0;
          }

          const targetModel = modelArg ?? 'grok-4.1-fast-reasoning';

          try {
            const rates = await fetchExchangeRates();
            const pricing = getModelPricing(targetModel);
            const sampleUsd = calculateBaseUsdCost(targetModel, 1000, 500);
            const sampleSol = usdToSol(sampleUsd, rates.solUsd);
            const sampleSlashbot = usdToSlashbot(sampleUsd, rates.solUsd, rates.slashbotSol);

            commandContext.stdout.write(
              [
                `Model: ${pricing.model}`,
                `Exchange rates: SOL/USD=${formatNumber(rates.solUsd, 2)}, SLASHBOT/SOL=${formatNumber(rates.slashbotSol, 9)}`,
                `Input per 1M: $${formatNumber(pricing.inputPricePerMillion)}`,
                `Output per 1M: $${formatNumber(pricing.outputPricePerMillion)}`,
                `Example (1000 in / 500 out): $${formatNumber(sampleUsd)} | ${formatNumber(sampleSol, 9)} SOL | ${formatNumber(sampleSlashbot)} SLASHBOT`,
              ].join('\n') + '\n',
            );
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Pricing failed: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'mode') {
          const mode = args[1]?.toLowerCase();
          if (!mode) {
            commandContext.stdout.write(`Current payment mode: ${paymentMode}\nUsage: solana mode <apikey|token> [password]\n`);
            return 0;
          }

          if (mode !== 'apikey' && mode !== 'token') {
            commandContext.stderr.write('Invalid mode. Use apikey or token.\n');
            return 1;
          }

          if (mode === 'token') {
            if (!(await walletExists())) {
              commandContext.stderr.write('No wallet configured. Use solana create or solana import first.\n');
              return 1;
            }

            if (!isSessionActive()) {
              const password = args[2];
              if (!password) {
                commandContext.stderr.write('Token mode needs an unlocked session. Use: solana mode token <password> or solana unlock <password>\n');
                return 1;
              }
              const unlocked = await unlockSession(password);
              if (!unlocked) {
                commandContext.stderr.write('Invalid wallet password.\n');
                return 1;
              }
            }
          }

          await saveSettings({ paymentMode: mode });
          paymentMode = mode;
          commandContext.stdout.write(`Switched payment mode to ${mode}.\n`);
          return 0;
        }

        if (sub === 'usage') {
          const wallet = await readWallet();
          if (!wallet) {
            commandContext.stderr.write('No wallet configured.\n');
            return 1;
          }

          if (paymentMode !== 'token') {
            commandContext.stderr.write('Usage tracking is available only in token mode. Run: solana mode token <password>\n');
            return 1;
          }

          if (!isSessionActive()) {
            commandContext.stderr.write('Wallet session is locked. Run: solana unlock <password>\n');
            return 1;
          }

          const usageSub = args[1]?.toLowerCase();

          try {
            if (usageSub === 'stats') {
              const period = args[2]?.toLowerCase() ?? 'month';
              if (!['day', 'week', 'month', 'all'].includes(period)) {
                commandContext.stderr.write('Invalid period. Use day, week, month, or all.\n');
                return 1;
              }

              const data = await fetchUsage('stats', { period });
              commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
              return 0;
            }

            if (usageSub === 'history') {
              const limitRaw = args[2] ?? '10';
              const limit = Number(limitRaw);
              if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
                commandContext.stderr.write('History limit must be an integer between 1 and 50.\n');
                return 1;
              }

              const data = await fetchUsage('history', { limit });
              commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
              return 0;
            }

            if (usageSub === 'models') {
              const data = await fetchUsage('stats', { period: 'month' });
              commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
              return 0;
            }

            const data = await fetchUsage('summary');
            commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
            return 0;
          } catch (err) {
            commandContext.stderr.write(`Failed to fetch usage: ${String(err)}\n`);
            return 1;
          }
        }

        if (sub === 'status') {
          const wallet = await readWallet();
          const settings = await readSettings();
          const proxyBaseUrl = resolveProxyBaseUrl(settings);
          const sessionState = isSessionActive() ? 'active' : 'locked';

          let balances: WalletBalances | null = null;
          let credits: number | null = null;
          if (wallet) {
            [balances, credits] = await Promise.all([
              getBalances(wallet.publicKey).catch(() => null),
              getCreditBalance(wallet.publicKey),
            ]);
          }

          commandContext.stdout.write(
            [
              'Payment Mode Status',
              `Wallet: ${wallet?.publicKey ?? 'not configured'}`,
              `Mode: ${settings.paymentMode}`,
              `Session: ${sessionState}`,
              `Proxy URL: ${proxyBaseUrl}`,
              balances ? `SOL: ${formatNumber(balances.sol, 9)} | SLASHBOT: ${formatNumber(balances.slashbot, 4)}` : 'Balances: unavailable',
              `Credits: ${credits === null ? '(proxy unavailable)' : credits}`,
            ].join('\n') + '\n',
          );
          return 0;
        }

        const wallet = await readWallet();
        if (!wallet) {
          commandContext.stdout.write(
            'No wallet configured.\nUse: solana create <password>\nOr:  solana import <private-key> <password>\n',
          );
          return 0;
        }

        const [balances, credits] = await Promise.all([
          getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
          getCreditBalance(wallet.publicKey),
        ]);

        commandContext.stdout.write(
          [
            'Solana Overview',
            `Address: ${wallet.publicKey}`,
            `SOL: ${formatNumber(balances.sol, 9)}`,
            `SLASHBOT: ${formatNumber(balances.slashbot, 4)}`,
            `Credits: ${credits === null ? '(proxy unavailable)' : credits}`,
            '',
            'Commands:',
            'solana create <password>',
            'solana import <private-key> <password>',
            'solana import seed <password> <seed phrase...> [accountIndex]',
            'solana export <password>',
            'solana export seed <password>',
            'solana balance',
            'solana send <sol|slashbot> <address> <amount|all|max> [password]',
            'solana redeem <amount|all|max> [password]',
            'solana deposit',
            'solana pricing [model|models]',
            'solana mode [apikey|token] [password]',
            'solana usage [stats|history|models]',
            'solana unlock <password>',
            'solana lock',
            'solana status',
          ].join('\n') + '\n',
        );
        return 0;
      }

      context.registerCommand({
        id: 'solana',
        pluginId: PLUGIN_ID,
        description: 'Solana wallet management (create, import, export, balance, send, redeem, deposit, pricing, mode, usage, unlock, lock, status)',
        subcommands: ['create', 'import', 'export', 'balance', 'send', 'redeem', 'deposit', 'pricing', 'mode', 'usage', 'unlock', 'lock', 'status'],
        execute: executeSolanaCommand,
      });

      // Tool descriptions are self-explanatory; no extra prompt section needed.
    },
  };
}

export { createWalletPlugin as createPlugin };
