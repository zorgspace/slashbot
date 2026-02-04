/**
 * Exchange Rate Fetching
 * Fetches SOL/USD from CoinGecko and SLASHBOT/SOL from Jupiter
 */

import type { ExchangeRates } from './types';
import { DEFAULT_PRICING_CONFIG } from './types';

/** Cached exchange rates */
let cachedRates: ExchangeRates | null = null;

/**
 * Fetch SOL/USD price from CoinGecko
 */
async function fetchSolUsdPrice(): Promise<number> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json() as { solana?: { usd?: number } };

    if (!data.solana?.usd) {
      throw new Error('Invalid CoinGecko response');
    }

    return data.solana.usd;
  } catch (error) {
    console.error('Failed to fetch SOL/USD price:', error);
    // Fallback price (update periodically)
    return 150; // Approximate SOL price as fallback
  }
}

/**
 * Fetch SLASHBOT/SOL price from Jupiter API with fallbacks
 * Tries: Jupiter -> DexScreener -> Birdeye -> hardcoded
 */
async function fetchSlashbotSolPrice(): Promise<number> {
  const slashbotMint = DEFAULT_PRICING_CONFIG.slashbotMint;
  const solMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL

  // Try Jupiter first
  try {
    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${solMint}&outputMint=${slashbotMint}&amount=1000000000&slippageBps=50`,
      {
        headers: { 'Accept': 'application/json' },
      }
    );

    if (response.ok) {
      const data = await response.json() as { outAmount?: string; error?: string };
      if (!data.error && data.outAmount) {
        const slashbotPerSol = Number(data.outAmount) / 1e9;
        return 1 / slashbotPerSol;
      }
    }
  } catch {
    // Silently try fallback
  }

  // Fallback to alternative sources
  return await fetchSlashbotPriceFallback();
}

/**
 * Fallback method to fetch SLASHBOT price using DexScreener API
 */
async function fetchSlashbotPriceFallback(): Promise<number> {
  const slashbotMint = DEFAULT_PRICING_CONFIG.slashbotMint;

  // Try DexScreener first (most reliable, no API key needed)
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${slashbotMint}`,
      {
        headers: { 'Accept': 'application/json' },
      }
    );

    if (response.ok) {
      const data = await response.json() as {
        pairs?: Array<{
          priceUsd?: string;
          priceNative?: string;
          baseToken?: { symbol?: string };
        }>;
      };

      // Find SOL pair
      const solPair = data.pairs?.find(
        (p) => p.baseToken?.symbol === 'SLASHBOT' || p.priceNative
      );

      if (solPair?.priceNative) {
        // priceNative is price in SOL
        return parseFloat(solPair.priceNative);
      } else if (solPair?.priceUsd) {
        // Convert USD to SOL
        const solPrice = await fetchSolUsdPrice();
        return parseFloat(solPair.priceUsd) / solPrice;
      }
    }
  } catch {
    // Try next fallback
  }

  // Try Birdeye as second fallback
  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/price?address=${slashbotMint}`,
      {
        headers: {
          'Accept': 'application/json',
          'x-chain': 'solana',
        },
      }
    );

    if (response.ok) {
      const data = await response.json() as { data?: { value?: number } };
      if (data.data?.value) {
        const solPrice = await fetchSolUsdPrice();
        return data.data.value / solPrice;
      }
    }
  } catch {
    // Ignore and use hardcoded fallback
  }

  // Hardcoded fallback
  console.warn('Using fallback SLASHBOT price - exchange rates may be inaccurate');
  return 0.000001;
}

/**
 * Fetch current exchange rates
 * @param forceRefresh - Force refresh even if cache is valid
 */
export async function fetchExchangeRates(forceRefresh = false): Promise<ExchangeRates> {
  const now = Date.now();

  // Return cached rates if still valid
  if (
    !forceRefresh &&
    cachedRates &&
    now - cachedRates.updatedAt < DEFAULT_PRICING_CONFIG.cacheDurationMs
  ) {
    return cachedRates;
  }

  // Fetch both rates in parallel
  const [solUsd, slashbotSol] = await Promise.all([
    fetchSolUsdPrice(),
    fetchSlashbotSolPrice(),
  ]);

  cachedRates = {
    solUsd,
    slashbotSol,
    updatedAt: now,
  };

  return cachedRates;
}

/**
 * Get cached exchange rates (doesn't fetch if expired)
 * Returns null if no cached rates available
 */
export function getCachedRates(): ExchangeRates | null {
  return cachedRates;
}

/**
 * Clear cached exchange rates
 */
export function clearRatesCache(): void {
  cachedRates = null;
}

/**
 * Convert USD to SOL
 */
export function usdToSol(usd: number, solUsdPrice: number): number {
  return usd / solUsdPrice;
}

/**
 * Convert SOL to SLASHBOT tokens
 */
export function solToSlashbot(sol: number, slashbotSolPrice: number): number {
  return sol / slashbotSolPrice;
}

/**
 * Convert USD to SLASHBOT tokens
 */
export function usdToSlashbot(
  usd: number,
  solUsdPrice: number,
  slashbotSolPrice: number
): number {
  const sol = usdToSol(usd, solUsdPrice);
  return solToSlashbot(sol, slashbotSolPrice);
}
