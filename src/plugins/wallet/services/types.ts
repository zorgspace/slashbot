/**
 * Wallet Types
 */

/** Encrypted wallet storage format */
export interface EncryptedWallet {
  version: 1;
  encryptedKey: string;
  iv: string;
  salt: string;
  authTag: string;
  publicKey: string;
  createdAt: string;
  /** Encrypted seed phrase (if created with mnemonic) */
  encryptedSeed?: string;
  seedIv?: string;
  seedSalt?: string;
  seedAuthTag?: string;
}

/** Token balance */
export interface TokenBalance {
  raw: bigint;
  formatted: string;
  decimals: number;
}

/** Wallet balances */
export interface WalletBalances {
  sol: number;
  slashbot: number;
}

/** Transaction result */
export interface TransactionResult {
  success: boolean;
  signature?: string;
  error?: string;
}

/** Credit claim result */
export interface ClaimResult {
  success: boolean;
  creditsAwarded?: number;
  newBalance?: number;
  error?: string;
}

/** SLASHBOT token mint address */
export const SLASHBOT_TOKEN_MINT = 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS';

/** Token decimals */
export const TOKEN_DECIMALS = 9;

/** Treasury address for deposits */
export const TREASURY_ADDRESS = 'DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7';

/** Default Solana RPC endpoint */
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

// ===== Pricing Types =====

/** xAI model pricing per million tokens (in USD) */
export interface ModelPricing {
  /** Model identifier */
  model: string;
  /** Input token price per million tokens (USD) */
  inputPricePerMillion: number;
  /** Output token price per million tokens (USD) */
  outputPricePerMillion: number;
}

/** Exchange rates for price conversion */
export interface ExchangeRates {
  /** SOL price in USD */
  solUsd: number;
  /** SLASHBOT price in SOL */
  slashbotSol: number;
  /** Timestamp of last update */
  updatedAt: number;
}

/** Calculated cost for an API call */
export interface ApiCallCost {
  /** Cost in USD */
  usd: number;
  /** Cost in SOL */
  sol: number;
  /** Cost in SLASHBOT tokens */
  slashbot: number;
  /** Model used */
  model: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
}

/** Pricing configuration */
export interface PricingConfig {
  /** Cache duration in milliseconds */
  cacheDurationMs: number;
  /** SLASHBOT token mint address */
  slashbotMint: string;
}

/** Default pricing configuration */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  cacheDurationMs: 60_000, // 1 minute cache
  slashbotMint: 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS',
};
