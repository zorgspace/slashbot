/**
 * xAI Pricing Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  XAI_MODEL_PRICING,
  DEFAULT_MODEL_PRICING,
  getModelPricing,
  calculateBaseUsdCost,
} from './xaiPricing';

describe('xaiPricing', () => {
  describe('XAI_MODEL_PRICING', () => {
    it('contains known models', () => {
      const modelNames = XAI_MODEL_PRICING.map(p => p.model);
      expect(modelNames).toContain('grok-4-1-fast-reasoning');
      expect(modelNames).toContain('grok-code-fast-1');
      expect(modelNames).toContain('grok-2');
      expect(modelNames).toContain('grok-2-mini');
    });

    it('has valid pricing for all models', () => {
      for (const pricing of XAI_MODEL_PRICING) {
        expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
        expect(pricing.outputPricePerMillion).toBeGreaterThan(0);
        expect(typeof pricing.model).toBe('string');
        expect(pricing.model.length).toBeGreaterThan(0);
      }
    });
  });

  describe('DEFAULT_MODEL_PRICING', () => {
    it('has valid default pricing', () => {
      expect(DEFAULT_MODEL_PRICING.model).toBe('default');
      expect(DEFAULT_MODEL_PRICING.inputPricePerMillion).toBe(1.00);
      expect(DEFAULT_MODEL_PRICING.outputPricePerMillion).toBe(3.00);
    });
  });

  describe('getModelPricing', () => {
    it('returns exact match for known model', () => {
      const pricing = getModelPricing('grok-4-1-fast-reasoning');
      expect(pricing.model).toBe('grok-4-1-fast-reasoning');
      expect(pricing.inputPricePerMillion).toBe(0.20);
      expect(pricing.outputPricePerMillion).toBe(0.50);
    });

    it('returns exact match for grok-code-fast-1', () => {
      const pricing = getModelPricing('grok-code-fast-1');
      expect(pricing.model).toBe('grok-code-fast-1');
      expect(pricing.inputPricePerMillion).toBe(0.20);
      expect(pricing.outputPricePerMillion).toBe(1.50);
    });

    it('returns partial match when model name contains known model', () => {
      const pricing = getModelPricing('grok-2-latest');
      // Should match grok-2 as partial match
      expect(pricing.model).toBe('grok-2-latest');
      expect(pricing.inputPricePerMillion).toBe(2.00);
    });

    it('returns default pricing for unknown model', () => {
      const pricing = getModelPricing('completely-unknown-model');
      expect(pricing.model).toBe('completely-unknown-model');
      expect(pricing.inputPricePerMillion).toBe(DEFAULT_MODEL_PRICING.inputPricePerMillion);
      expect(pricing.outputPricePerMillion).toBe(DEFAULT_MODEL_PRICING.outputPricePerMillion);
    });

    it('handles empty model string', () => {
      const pricing = getModelPricing('');
      expect(pricing.model).toBe('');
      // Empty string might match partial patterns, just ensure it returns valid pricing
      expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
    });
  });

  describe('calculateBaseUsdCost', () => {
    it('calculates cost for known model', () => {
      // grok-4-1-fast-reasoning: $0.20/1M input, $0.50/1M output
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 1_000_000, 1_000_000);
      expect(cost).toBe(0.20 + 0.50);
    });

    it('calculates cost for smaller token amounts', () => {
      // grok-4-1-fast-reasoning: $0.20/1M input, $0.50/1M output
      // 1000 input tokens = 0.20 * 0.001 = 0.0002
      // 500 output tokens = 0.50 * 0.0005 = 0.00025
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 1000, 500);
      expect(cost).toBeCloseTo(0.0002 + 0.00025, 6);
    });

    it('calculates cost for zero tokens', () => {
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 0, 0);
      expect(cost).toBe(0);
    });

    it('calculates cost for input only', () => {
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 1_000_000, 0);
      expect(cost).toBe(0.20);
    });

    it('calculates cost for output only', () => {
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 0, 1_000_000);
      expect(cost).toBe(0.50);
    });

    it('uses default pricing for unknown model', () => {
      // Default: $1.00/1M input, $3.00/1M output
      const cost = calculateBaseUsdCost('unknown-model', 1_000_000, 1_000_000);
      expect(cost).toBe(1.00 + 3.00);
    });

    it('calculates correctly for high token counts', () => {
      // grok-3: $3.00/1M input, $15.00/1M output
      // 10M input = $30, 5M output = $75
      const cost = calculateBaseUsdCost('grok-3', 10_000_000, 5_000_000);
      expect(cost).toBe(30 + 75);
    });

    it('handles fractional token counts', () => {
      const cost = calculateBaseUsdCost('grok-4-1-fast-reasoning', 100, 50);
      // 100 input = 0.20 * 0.0001 = 0.00002
      // 50 output = 0.50 * 0.00005 = 0.000025
      expect(cost).toBeCloseTo(0.00002 + 0.000025, 8);
    });
  });
});
