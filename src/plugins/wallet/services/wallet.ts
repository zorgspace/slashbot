/**
 * Wallet Manager
 * Handles wallet creation, storage, and operations
 */

import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  verifyPassword,
  createSignatureMessage,
  signMessage,
  hashData,
} from './crypto';
import {
  importKeypair,
  getSolBalance,
  getSlashbotBalance,
  transferSol,
  transferSlashbot,
  isValidAddress,
} from './solana';
import {
  type EncryptedWallet,
  type WalletBalances,
  type TransactionResult,
  type ClaimResult,
  TREASURY_ADDRESS,
} from './types';
import { HOME_SLASHBOT_DIR, PROXY_CONFIG } from '../../../core/config/constants';

const WALLET_PATH = path.join(HOME_SLASHBOT_DIR, 'wallet.json');

/**
 * Check if wallet exists
 */
export function walletExists(): boolean {
  return fs.existsSync(WALLET_PATH);
}

/**
 * Load encrypted wallet from file
 */
export function loadWallet(): EncryptedWallet | null {
  try {
    if (!fs.existsSync(WALLET_PATH)) return null;
    const data = fs.readFileSync(WALLET_PATH, 'utf-8');
    return JSON.parse(data) as EncryptedWallet;
  } catch {
    return null;
  }
}

/**
 * Save encrypted wallet to file
 */
function saveWallet(wallet: EncryptedWallet): void {
  const dir = path.dirname(WALLET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2));
}

/**
 * Get wallet public key without unlocking
 */
export function getPublicKey(): string | null {
  const wallet = loadWallet();
  return wallet?.publicKey || null;
}

/**
 * Create a new wallet with seed phrase
 */
export function createWallet(password: string): {
  publicKey: string;
  seedPhrase: string;
  wallet: EncryptedWallet;
} {
  // Generate a new seed phrase
  const seedPhrase = bip39.generateMnemonic();

  // Derive keypair from seed
  const seed = bip39.mnemonicToSeedSync(seedPhrase);
  const derivationPath = `m/44'/501'/0'/0'`;
  const derived = derivePath(derivationPath, seed.toString('hex'));
  const keypair = Keypair.fromSeed(derived.key);

  // Encrypt the private key
  const encrypted = encryptPrivateKey(keypair.secretKey, password);

  // Encrypt the seed phrase
  const seedEncrypted = encryptPrivateKey(new TextEncoder().encode(seedPhrase), password);

  const wallet: EncryptedWallet = {
    version: 1,
    ...encrypted,
    publicKey: keypair.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    encryptedSeed: seedEncrypted.encryptedKey,
    seedIv: seedEncrypted.iv,
    seedSalt: seedEncrypted.salt,
    seedAuthTag: seedEncrypted.authTag,
  };

  saveWallet(wallet);

  return { publicKey: wallet.publicKey, seedPhrase, wallet };
}

/**
 * Import wallet from private key (base58)
 */
export function importWallet(
  privateKeyBase58: string,
  password: string,
): { publicKey: string; wallet: EncryptedWallet } {
  const secretKey = bs58.decode(privateKeyBase58);
  const keypair = importKeypair(secretKey);
  const encrypted = encryptPrivateKey(keypair.secretKey, password);

  const wallet: EncryptedWallet = {
    version: 1,
    ...encrypted,
    publicKey: keypair.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
  };

  saveWallet(wallet);

  return { publicKey: wallet.publicKey, wallet };
}

/**
 * Derive keypair from seed phrase using Solana derivation path
 */
function deriveKeypairFromSeed(seedPhrase: string, accountIndex = 0): Keypair {
  const seed = bip39.mnemonicToSeedSync(seedPhrase);
  const derivationPath = `m/44'/501'/${accountIndex}'/0'`;
  const derived = derivePath(derivationPath, seed.toString('hex'));
  return Keypair.fromSeed(derived.key);
}

/**
 * Validate seed phrase
 */
export function isValidSeedPhrase(seedPhrase: string): boolean {
  return bip39.validateMnemonic(seedPhrase);
}

/**
 * Import wallet from seed phrase (12 or 24 words)
 */
export function importWalletFromSeed(
  seedPhrase: string,
  password: string,
  accountIndex = 0,
): { publicKey: string; wallet: EncryptedWallet } {
  // Normalize seed phrase
  const normalized = seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ');

  if (!isValidSeedPhrase(normalized)) {
    throw new Error('Invalid seed phrase');
  }

  const keypair = deriveKeypairFromSeed(normalized, accountIndex);
  const encrypted = encryptPrivateKey(keypair.secretKey, password);

  // Encrypt the seed phrase for later export
  const seedEncrypted = encryptPrivateKey(new TextEncoder().encode(normalized), password);

  const wallet: EncryptedWallet = {
    version: 1,
    ...encrypted,
    publicKey: keypair.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    encryptedSeed: seedEncrypted.encryptedKey,
    seedIv: seedEncrypted.iv,
    seedSalt: seedEncrypted.salt,
    seedAuthTag: seedEncrypted.authTag,
  };

  saveWallet(wallet);

  return { publicKey: wallet.publicKey, wallet };
}

/**
 * Unlock wallet and get keypair
 */
export function unlockWallet(password: string): Keypair | null {
  const wallet = loadWallet();
  if (!wallet) return null;

  try {
    const secretKey = decryptPrivateKey(
      wallet.encryptedKey,
      wallet.iv,
      wallet.salt,
      wallet.authTag,
      password,
    );
    return importKeypair(secretKey);
  } catch {
    return null;
  }
}

/**
 * Verify wallet password
 */
export function verifyWalletPassword(password: string): boolean {
  const wallet = loadWallet();
  if (!wallet) return false;
  return verifyPassword(wallet.encryptedKey, wallet.iv, wallet.salt, wallet.authTag, password);
}

/**
 * Export private key (requires password)
 */
export function exportPrivateKey(password: string): string | null {
  const keypair = unlockWallet(password);
  if (!keypair) return null;
  return bs58.encode(keypair.secretKey);
}

/**
 * Export seed phrase (requires password)
 * Returns null if wallet was imported from private key (no seed stored)
 */
export function exportSeedPhrase(password: string): string | null {
  const wallet = loadWallet();
  if (!wallet) return null;

  // Check if seed phrase is stored
  if (!wallet.encryptedSeed || !wallet.seedIv || !wallet.seedSalt || !wallet.seedAuthTag) {
    return null; // Wallet was imported from private key, no seed available
  }

  try {
    const decrypted = decryptPrivateKey(
      wallet.encryptedSeed,
      wallet.seedIv,
      wallet.seedSalt,
      wallet.seedAuthTag,
      password,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Check if wallet has a seed phrase stored
 */
export function hasSeedPhrase(): boolean {
  const wallet = loadWallet();
  return !!(wallet?.encryptedSeed && wallet?.seedIv && wallet?.seedSalt && wallet?.seedAuthTag);
}

/**
 * Get wallet balances
 */
export async function getBalances(): Promise<WalletBalances | null> {
  const publicKeyStr = getPublicKey();
  if (!publicKeyStr) return null;

  try {
    const publicKey = new PublicKey(publicKeyStr);
    const [sol, slashbot] = await Promise.all([
      getSolBalance(publicKey),
      getSlashbotBalance(publicKey),
    ]);

    return {
      sol,
      slashbot: parseFloat(slashbot.formatted),
    };
  } catch {
    return null;
  }
}

/**
 * Send SOL
 */
export async function sendSol(
  password: string,
  toAddress: string,
  amount: number,
): Promise<TransactionResult> {
  if (!isValidAddress(toAddress)) {
    return { success: false, error: 'Invalid destination address' };
  }

  const keypair = unlockWallet(password);
  if (!keypair) {
    return { success: false, error: 'Invalid password' };
  }

  return transferSol(keypair, toAddress, amount);
}

/**
 * Send SLASHBOT tokens
 */
export async function sendSlashbot(
  password: string,
  toAddress: string,
  amount: number,
): Promise<TransactionResult> {
  if (!isValidAddress(toAddress)) {
    return { success: false, error: 'Invalid destination address' };
  }

  const keypair = unlockWallet(password);
  if (!keypair) {
    return { success: false, error: 'Invalid password' };
  }

  return transferSlashbot(keypair, toAddress, amount);
}

/**
 * Send SLASHBOT to treasury and claim credits instantly
 */
export async function redeemCredits(password: string, amount: number): Promise<ClaimResult> {
  // First, send tokens to treasury
  const transferResult = await sendSlashbot(password, TREASURY_ADDRESS, amount);

  if (!transferResult.success) {
    return { success: false, error: transferResult.error };
  }

  // Then claim credits via proxy
  const publicKey = getPublicKey();
  if (!publicKey) {
    return { success: false, error: 'No wallet configured' };
  }

  const proxyUrl = PROXY_CONFIG.BASE_URL;

  try {
    const response = await fetch(`${proxyUrl}/api/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: publicKey,
        transaction_signature: transferResult.signature,
        token_type: 'SLASHBOT',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: (error as { error?: string }).error || 'Failed to claim credits',
      };
    }

    const result = (await response.json()) as {
      creditsAwarded: number;
      newBalance: number;
    };

    return {
      success: true,
      creditsAwarded: result.creditsAwarded,
      newBalance: result.newBalance,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to claim credits',
    };
  }
}

/**
 * Get credit balance from proxy
 */
export async function getCreditBalance(): Promise<number | null> {
  const publicKey = getPublicKey();
  if (!publicKey) return null;

  const proxyUrl = PROXY_CONFIG.BASE_URL;

  try {
    const response = await fetch(`${proxyUrl}/api/credits?wallet=${publicKey}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { credits: number };
    return data.credits;
  } catch {
    return null;
  }
}

/**
 * Create authentication headers for proxy requests
 * Signs a timestamp-based message with the wallet's private key
 */
export function createAuthHeaders(password: string): {
  'X-Wallet-Address': string;
  'X-Wallet-Signature': string;
  'X-Wallet-Timestamp': string;
} | null {
  const keypair = unlockWallet(password);
  if (!keypair) return null;

  const publicKey = keypair.publicKey.toBase58();
  const { message, timestamp } = createSignatureMessage(publicKey);
  const signature = signMessage(message, keypair.secretKey);

  return {
    'X-Wallet-Address': publicKey,
    'X-Wallet-Signature': signature,
    'X-Wallet-Timestamp': timestamp.toString(),
  };
}

/**
 * Session-based authentication (caches unlocked keypair for the session)
 */
let sessionKeypair: Keypair | null = null;
let sessionExpiry: number = 0;
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Unlock wallet for session (caches keypair in memory)
 */
export function unlockSession(password: string): boolean {
  const keypair = unlockWallet(password);
  if (!keypair) return false;

  sessionKeypair = keypair;
  sessionExpiry = Date.now() + SESSION_DURATION;
  return true;
}

/**
 * Check if session is active
 */
export function isSessionActive(): boolean {
  return sessionKeypair !== null && Date.now() < sessionExpiry;
}

/**
 * Get auth headers using session (no password needed if session active)
 * @param requestBody - Optional request body to include hash in signature (prevents replay)
 */
export function getSessionAuthHeaders(requestBody?: string): {
  'X-Wallet-Address': string;
  'X-Wallet-Signature': string;
  'X-Wallet-Timestamp': string;
  'X-Body-Hash'?: string;
} | null {
  if (!sessionKeypair || Date.now() >= sessionExpiry) {
    sessionKeypair = null;
    return null;
  }

  // Extend session on activity
  sessionExpiry = Date.now() + SESSION_DURATION;

  const publicKey = sessionKeypair.publicKey.toBase58();
  const bodyHash = requestBody ? hashData(requestBody) : undefined;
  const { message, timestamp } = createSignatureMessage(publicKey, bodyHash);
  const signature = signMessage(message, sessionKeypair.secretKey);

  const headers: {
    'X-Wallet-Address': string;
    'X-Wallet-Signature': string;
    'X-Wallet-Timestamp': string;
    'X-Body-Hash'?: string;
  } = {
    'X-Wallet-Address': publicKey,
    'X-Wallet-Signature': signature,
    'X-Wallet-Timestamp': timestamp.toString(),
  };

  if (bodyHash) {
    headers['X-Body-Hash'] = bodyHash;
  }

  return headers;
}

/**
 * Clear session
 */
export function clearSession(): void {
  sessionKeypair = null;
  sessionExpiry = 0;
}

export { isValidAddress, WALLET_PATH };
