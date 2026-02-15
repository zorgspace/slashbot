/**
 * wallet/pricing.ts — Exchange rate fetching, model pricing, and conversion utilities.
 *
 * Exports functions for SOL/USD pricing, SLASHBOT/SOL pricing, model cost calculations,
 * and number formatting helpers.
 */
import { SLASHBOT_TOKEN_MINT } from './solana.js';

export interface ModelPricing {
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface ExchangeRates {
  solUsd: number;
  slashbotSol: number;
  updatedAt: number;
}

export const XAI_MODEL_PRICING: ModelPricing[] = [
  {
    model: 'grok-4.1-fast-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  {
    model: 'grok-4.1-fast-non-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  {
    model: 'grok-code-fast-1',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.5,
  },
];

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  model: 'default',
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 3.0,
};

/**
 * Format a number for display with appropriate precision.
 */
export function formatNumber(num: number, decimals = 6): string {
  if (!Number.isFinite(num)) return '0';
  if (num === 0) return '0';
  if (Math.abs(num) < 0.000001) return num.toExponential(2);
  if (Math.abs(num) < 1) return num.toFixed(decimals);
  if (Math.abs(num) < 1000) return num.toFixed(Math.min(6, decimals));
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Parse an amount argument string into a structured result.
 * Supports "all", "max", or a positive number.
 */
export function parseAmountArg(raw: string | undefined): { all: boolean; value: number } {
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

/**
 * Fetch the current SOL/USD price from CoinGecko. Falls back to $150.
 */
export async function fetchSolUsdPrice(): Promise<number> {
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

/**
 * Fetch the current SLASHBOT/SOL price from Jupiter and DexScreener.
 * Falls back to 0.000001.
 */
export async function fetchSlashbotSolPrice(tokenMint: string = SLASHBOT_TOKEN_MINT): Promise<number> {
  const solMint = 'So11111111111111111111111111111111111111112';

  try {
    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${solMint}&outputMint=${tokenMint}&amount=1000000000&slippageBps=50`,
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
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
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

/**
 * Fetch exchange rates (SOL/USD and SLASHBOT/SOL) with optional caching.
 * Pass a cache object to enable caching across calls.
 */
export async function fetchExchangeRates(
  forceRefresh = false,
  cache?: { rates: ExchangeRates | null },
): Promise<ExchangeRates> {
  const now = Date.now();

  if (!forceRefresh && cache?.rates && now - cache.rates.updatedAt < 60_000) {
    return cache.rates;
  }

  const [solUsd, slashbotSol] = await Promise.all([
    fetchSolUsdPrice(),
    fetchSlashbotSolPrice(),
  ]);

  const rates: ExchangeRates = { solUsd, slashbotSol, updatedAt: now };
  if (cache) {
    cache.rates = rates;
  }
  return rates;
}

/**
 * Get pricing info for a given model. Falls back to DEFAULT_MODEL_PRICING.
 */
export function getModelPricing(model: string): ModelPricing {
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

/**
 * Calculate the base USD cost for a given model and token usage.
 */
export function calculateBaseUsdCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return inputCost + outputCost;
}

/**
 * Convert USD to SOL.
 */
export function usdToSol(usd: number, solUsdPrice: number): number {
  return usd / solUsdPrice;
}

/**
 * Convert SOL to SLASHBOT tokens.
 */
export function solToSlashbot(sol: number, slashbotSolPrice: number): number {
  return sol / slashbotSolPrice;
}

/**
 * Convert USD to SLASHBOT tokens (via SOL).
 */
export function usdToSlashbot(usd: number, solUsdPrice: number, slashbotSolPrice: number): number {
  return solToSlashbot(usdToSol(usd, solUsdPrice), slashbotSolPrice);
}
