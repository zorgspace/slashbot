/**
 * Exchange Rates Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchExchangeRates,
  getCachedRates,
  clearRatesCache,
  usdToSol,
  solToSlashbot,
  usdToSlashbot,
} from './exchangeRates';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('exchangeRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRatesCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('usdToSol', () => {
    it('converts USD to SOL correctly', () => {
      const sol = usdToSol(100, 200); // $100 at $200/SOL = 0.5 SOL
      expect(sol).toBe(0.5);
    });

    it('handles zero USD', () => {
      const sol = usdToSol(0, 200);
      expect(sol).toBe(0);
    });

    it('handles small amounts', () => {
      const sol = usdToSol(0.01, 200); // $0.01 at $200/SOL = 0.00005 SOL
      expect(sol).toBeCloseTo(0.00005, 8);
    });

    it('handles large amounts', () => {
      const sol = usdToSol(10000, 150); // $10000 at $150/SOL
      expect(sol).toBeCloseTo(66.6667, 4);
    });
  });

  describe('solToSlashbot', () => {
    it('converts SOL to SLASHBOT correctly', () => {
      // 1 SOL at 0.000001 SLASHBOT/SOL = 1,000,000 SLASHBOT
      const slashbot = solToSlashbot(1, 0.000001);
      expect(slashbot).toBe(1_000_000);
    });

    it('handles zero SOL', () => {
      const slashbot = solToSlashbot(0, 0.000001);
      expect(slashbot).toBe(0);
    });

    it('handles small SOL amounts', () => {
      // 0.001 SOL at 0.000001 SLASHBOT/SOL price = 0.001 / 0.000001 = 1000 SLASHBOT
      const slashbot = solToSlashbot(0.001, 0.000001);
      expect(slashbot).toBeCloseTo(1000, 0);
    });
  });

  describe('usdToSlashbot', () => {
    it('converts USD to SLASHBOT correctly', () => {
      // $100 at $200/SOL = 0.5 SOL
      // 0.5 SOL at 0.000001 SLASHBOT/SOL = 500,000 SLASHBOT
      const slashbot = usdToSlashbot(100, 200, 0.000001);
      expect(slashbot).toBe(500_000);
    });

    it('handles zero USD', () => {
      const slashbot = usdToSlashbot(0, 200, 0.000001);
      expect(slashbot).toBe(0);
    });

    it('handles different exchange rates', () => {
      // $10 at $100/SOL = 0.1 SOL
      // 0.1 SOL at 0.00001 SLASHBOT/SOL = 10,000 SLASHBOT
      const slashbot = usdToSlashbot(10, 100, 0.00001);
      expect(slashbot).toBe(10_000);
    });
  });

  describe('fetchExchangeRates', () => {
    it('fetches rates from APIs successfully', async () => {
      // Mock CoinGecko response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      // Mock Jupiter response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }), // 1000 SLASHBOT per SOL
      });

      const rates = await fetchExchangeRates();

      expect(rates.solUsd).toBe(150);
      expect(rates.slashbotSol).toBeCloseTo(0.001, 6); // 1/1000
      expect(rates.updatedAt).toBeGreaterThan(0);
    });

    it('returns cached rates on subsequent calls', async () => {
      // Mock successful responses
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const rates1 = await fetchExchangeRates();
      const rates2 = await fetchExchangeRates();

      // Should return same cached rates without additional fetch calls
      expect(rates1).toEqual(rates2);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Only initial calls
    });

    it('force refresh bypasses cache', async () => {
      // First fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      await fetchExchangeRates();

      // Force refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 160 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '2000000000000' }),
      });

      const rates = await fetchExchangeRates(true);

      expect(rates.solUsd).toBe(160);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('uses fallback SOL price on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const rates = await fetchExchangeRates();

      // Should use fallback price of 150
      expect(rates.solUsd).toBe(150);
    });

    it('uses fallback SLASHBOT price when Jupiter fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      // Jupiter fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      // DexScreener fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      // Birdeye fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const rates = await fetchExchangeRates();

      // Should use fallback SLASHBOT price
      expect(rates.slashbotSol).toBe(0.000001);
    });
  });

  describe('getCachedRates', () => {
    it('returns null when no rates cached', () => {
      const rates = getCachedRates();
      expect(rates).toBeNull();
    });

    it('returns cached rates after fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      await fetchExchangeRates();
      const cached = getCachedRates();

      expect(cached).not.toBeNull();
      expect(cached?.solUsd).toBe(150);
    });
  });

  describe('clearRatesCache', () => {
    it('clears cached rates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      await fetchExchangeRates();
      expect(getCachedRates()).not.toBeNull();

      clearRatesCache();
      expect(getCachedRates()).toBeNull();
    });
  });
});
