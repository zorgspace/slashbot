/**
 * wallet/types.ts — Zod schemas, interfaces, type aliases, and constants for the wallet plugin.
 *
 * This module is the leaf dependency: imported by wallet-service.ts, wallet-commands.ts, and index.ts.
 * It re-exports relevant types/constants from sibling modules so that consumers have a single import point.
 */
import { z } from 'zod';

// ── Re-exports from sibling modules ─────────────────────────────────────

export type { TokenType, WalletBalances } from './solana.js';
export {
  DEFAULT_SOLANA_RPC_URL,
  SLASHBOT_TOKEN_MINT,
  TREASURY_ADDRESS,
  TOKEN_DECIMALS,
} from './solana.js';

export type { ModelPricing, ExchangeRates } from './pricing.js';
export {
  XAI_MODEL_PRICING,
  DEFAULT_MODEL_PRICING,
  formatNumber,
  parseAmountArg,
} from './pricing.js';

export type { PaymentMode, SessionKeypair } from './proxy-auth.js';

// ── Plugin identity ─────────────────────────────────────────────────────

export const PLUGIN_ID = 'slashbot.wallet';
export const SESSION_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_PROXY_BASE_URL = 'https://getslashbot.com';

// ── Zod schemas ─────────────────────────────────────────────────────────

export const WalletDataSchema = z.object({
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

export const WalletSettingsSchema = z.object({
  paymentMode: z.enum(['apikey', 'token']).default('apikey'),
  proxyBaseUrl: z.string().optional(),
});

// ── Interfaces ──────────────────────────────────────────────────────────

export interface WalletData {
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

export interface WalletSettings {
  paymentMode: 'apikey' | 'token';
  proxyBaseUrl?: string;
}

export interface LegacyWalletConfig {
  proxyUrl?: string;
}
