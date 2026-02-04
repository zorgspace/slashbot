/**
 * Dynamic Pricing Types
 * Calculates token costs based on xAI pricing and real-time exchange rates
 */

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
  /** Price multiplier (e.g., 5x xAI prices) */
  multiplier: number;
  /** Cache duration in milliseconds */
  cacheDurationMs: number;
  /** SLASHBOT token mint address */
  slashbotMint: string;
}

/** Default pricing configuration */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  multiplier: 2.5, // 2.5x xAI prices
  cacheDurationMs: 60_000, // 1 minute cache
  slashbotMint: 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS',
};
