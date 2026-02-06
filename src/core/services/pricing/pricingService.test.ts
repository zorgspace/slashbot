/**
 * Pricing Service Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PricingService, getPricingService, initPricingService } from './pricingService';
import { clearRatesCache } from './exchangeRates';
import type { ExchangeRates } from './types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('PricingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRatesCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates service with default config', () => {
      const service = new PricingService();
      expect(service.getMultiplier()).toBe(2.5);
    });

    it('creates service with custom multiplier', () => {
      const service = new PricingService({ multiplier: 5 });
      expect(service.getMultiplier()).toBe(5);
    });
  });

  describe('getMultiplier / setMultiplier', () => {
    it('gets and sets multiplier', () => {
      const service = new PricingService();
      expect(service.getMultiplier()).toBe(2.5);

      service.setMultiplier(10);
      expect(service.getMultiplier()).toBe(10);
    });
  });

  describe('calculateCost', () => {
    const mockRates: ExchangeRates = {
      solUsd: 150,
      slashbotSol: 0.000001,
      updatedAt: Date.now(),
    };

    it('calculates cost with provided rates', async () => {
      const service = new PricingService({ multiplier: 5 });

      // grok-4-1-fast-reasoning: $0.20/1M input, $0.50/1M output
      // With 5x multiplier: $1.00/1M input, $2.50/1M output
      // 1M input + 1M output = $1.00 + $2.50 = $3.50
      const cost = await service.calculateCost(
        'grok-4-1-fast-reasoning',
        1_000_000,
        1_000_000,
        mockRates
      );

      expect(cost.usd).toBe(3.50);
      expect(cost.model).toBe('grok-4-1-fast-reasoning');
      expect(cost.inputTokens).toBe(1_000_000);
      expect(cost.outputTokens).toBe(1_000_000);
    });

    it('converts USD to SOL correctly', async () => {
      const service = new PricingService({ multiplier: 5 });

      const cost = await service.calculateCost(
        'grok-4-1-fast-reasoning',
        1_000_000,
        1_000_000,
        mockRates
      );

      // $3.50 at $150/SOL = 0.02333... SOL
      expect(cost.sol).toBeCloseTo(3.50 / 150, 6);
    });

    it('converts USD to SLASHBOT correctly', async () => {
      const service = new PricingService({ multiplier: 5 });

      const cost = await service.calculateCost(
        'grok-4-1-fast-reasoning',
        1_000_000,
        1_000_000,
        mockRates
      );

      // $3.50 at $150/SOL = 0.02333 SOL
      // 0.02333 SOL at 0.000001 SLASHBOT/SOL = 23,333 SLASHBOT
      const expectedSol = 3.50 / 150;
      const expectedSlashbot = expectedSol / 0.000001;
      expect(cost.slashbot).toBeCloseTo(expectedSlashbot, 0);
    });

    it('handles zero tokens', async () => {
      const service = new PricingService({ multiplier: 5 });
      const cost = await service.calculateCost('grok-4-1-fast-reasoning', 0, 0, mockRates);

      expect(cost.usd).toBe(0);
      expect(cost.sol).toBe(0);
      expect(cost.slashbot).toBe(0);
    });

    it('fetches rates if not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService();
      const cost = await service.calculateCost('grok-4-1-fast-reasoning', 1000, 500);

      expect(cost.usd).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('calculateCostSync', () => {
    it('returns null when no cached rates', () => {
      const service = new PricingService();
      const cost = service.calculateCostSync('grok-4-1-fast-reasoning', 1000, 500);
      expect(cost).toBeNull();
    });

    it('calculates cost from cached rates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService();
      await service.refreshRates(); // Populate cache

      const cost = service.calculateCostSync('grok-4-1-fast-reasoning', 1_000_000, 1_000_000);

      expect(cost).not.toBeNull();
      expect(cost!.usd).toBeGreaterThan(0);
    });
  });

  describe('estimateCost', () => {
    it('estimates cost with default output tokens', async () => {
      const mockRates: ExchangeRates = {
        solUsd: 150,
        slashbotSol: 0.000001,
        updatedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService();
      const cost = await service.estimateCost('grok-4-1-fast-reasoning', 1000);

      expect(cost.inputTokens).toBe(1000);
      expect(cost.outputTokens).toBe(1000); // Default
    });

    it('estimates cost with custom output tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService();
      const cost = await service.estimateCost('grok-4-1-fast-reasoning', 1000, 2000);

      expect(cost.inputTokens).toBe(1000);
      expect(cost.outputTokens).toBe(2000);
    });
  });

  describe('getPricingInfo', () => {
    it('returns complete pricing info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService({ multiplier: 5 });
      const info = await service.getPricingInfo('grok-4-1-fast-reasoning');

      expect(info.model).toBe('grok-4-1-fast-reasoning');
      expect(info.multiplier).toBe(5);
      expect(info.exchangeRates.solUsd).toBe(150);

      // Check input pricing (base $0.20 * 5 = $1.00)
      expect(info.inputPricePerMillion.usd).toBe(1.00);
      expect(info.inputPricePerMillion.sol).toBeCloseTo(1.00 / 150, 6);

      // Check output pricing (base $0.50 * 5 = $2.50)
      expect(info.outputPricePerMillion.usd).toBe(2.50);
      expect(info.outputPricePerMillion.sol).toBeCloseTo(2.50 / 150, 6);
    });
  });

  describe('getExchangeRates', () => {
    it('fetches and returns exchange rates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 175 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '2000000000000' }),
      });

      const service = new PricingService();
      const rates = await service.getExchangeRates();

      expect(rates.solUsd).toBe(175);
      expect(rates.slashbotSol).toBeCloseTo(0.0005, 6);
    });
  });

  describe('refreshRates', () => {
    it('force refreshes exchange rates', async () => {
      // First fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 150 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1000000000000' }),
      });

      const service = new PricingService();
      await service.warmCache();

      // Refresh with new values
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 200 } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ outAmount: '1500000000000' }),
      });

      const rates = await service.refreshRates();

      expect(rates.solUsd).toBe(200);
    });
  });

  describe('formatCost', () => {
    it('formats cost for display', () => {
      const service = new PricingService();
      const formatted = service.formatCost({
        model: 'grok-4-1-fast-reasoning',
        inputTokens: 1000,
        outputTokens: 500,
        usd: 0.001234,
        sol: 0.00000823,
        slashbot: 8.23,
      });

      expect(formatted).toContain('grok-4-1-fast-reasoning');
      expect(formatted).toContain('1,000');
      expect(formatted).toContain('500');
      expect(formatted).toContain('$');
      expect(formatted).toContain('SOL');
      expect(formatted).toContain('$SLASHBOT');
    });
  });
});

describe('getPricingService', () => {
  it('returns singleton instance', () => {
    const service1 = getPricingService();
    const service2 = getPricingService();
    expect(service1).toBe(service2);
  });
});

describe('initPricingService', () => {
  it('initializes with custom config', () => {
    const service = initPricingService({ multiplier: 10 });
    expect(service.getMultiplier()).toBe(10);
  });
});
