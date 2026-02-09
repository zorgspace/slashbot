/**
 * Dynamic Pricing Service
 * Calculates API call costs based on xAI pricing with 5x multiplier
 * Converts to SLASHBOT tokens using real-time exchange rates
 */

import type { ApiCallCost, ExchangeRates, PricingConfig } from './types';
import { DEFAULT_PRICING_CONFIG } from './types';
import { calculateBaseUsdCost, getModelPricing } from './xaiPricing';
import { fetchExchangeRates, getCachedRates, usdToSol, usdToSlashbot } from './exchangeRates';

export class PricingService {
  private config: PricingConfig;

  constructor(config: Partial<PricingConfig> = {}) {
    this.config = { ...DEFAULT_PRICING_CONFIG, ...config };
  }

  /**
   * Calculate the cost for an API call
   * @param model - Model identifier
   * @param inputTokens - Number of input tokens used
   * @param outputTokens - Number of output tokens used
   * @param rates - Optional pre-fetched exchange rates
   */
  async calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    rates?: ExchangeRates,
  ): Promise<ApiCallCost> {
    // Get exchange rates
    const exchangeRates = rates || (await fetchExchangeRates());

    // Calculate base USD cost from xAI pricing
    const baseUsdCost = calculateBaseUsdCost(model, inputTokens, outputTokens);

    // Convert to SOL
    const solCost = usdToSol(baseUsdCost, exchangeRates.solUsd);

    // Convert to SLASHBOT tokens
    const slashbotCost = usdToSlashbot(
      baseUsdCost,
      exchangeRates.solUsd,
      exchangeRates.slashbotSol,
    );

    return {
      usd: baseUsdCost,
      sol: solCost,
      slashbot: slashbotCost,
      model,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Calculate cost synchronously using cached rates
   * Returns null if no cached rates are available
   */
  calculateCostSync(model: string, inputTokens: number, outputTokens: number): ApiCallCost | null {
    const rates = getCachedRates();
    if (!rates) return null;

    const baseUsdCost = calculateBaseUsdCost(model, inputTokens, outputTokens);
    const solCost = usdToSol(baseUsdCost, rates.solUsd);
    const slashbotCost = usdToSlashbot(baseUsdCost, rates.solUsd, rates.slashbotSol);

    return {
      usd: baseUsdCost,
      sol: solCost,
      slashbot: slashbotCost,
      model,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Estimate cost before making an API call
   * Uses average output tokens based on model
   */
  async estimateCost(
    model: string,
    inputTokens: number,
    estimatedOutputTokens = 1000,
  ): Promise<ApiCallCost> {
    return this.calculateCost(model, inputTokens, estimatedOutputTokens);
  }

  /**
   * Get pricing info for display
   */
  async getPricingInfo(model: string): Promise<{
    model: string;
    inputPricePerMillion: { usd: number; sol: number; slashbot: number };
    outputPricePerMillion: { usd: number; sol: number; slashbot: number };
    exchangeRates: ExchangeRates;
  }> {
    const rates = await fetchExchangeRates();
    const pricing = getModelPricing(model);

    const inputUsd = pricing.inputPricePerMillion;
    const outputUsd = pricing.outputPricePerMillion;

    return {
      model: pricing.model,
      inputPricePerMillion: {
        usd: inputUsd,
        sol: usdToSol(inputUsd, rates.solUsd),
        slashbot: usdToSlashbot(inputUsd, rates.solUsd, rates.slashbotSol),
      },
      outputPricePerMillion: {
        usd: outputUsd,
        sol: usdToSol(outputUsd, rates.solUsd),
        slashbot: usdToSlashbot(outputUsd, rates.solUsd, rates.slashbotSol),
      },
      exchangeRates: rates,
    };
  }

  /**
   * Get current exchange rates
   */
  async getExchangeRates(): Promise<ExchangeRates> {
    return fetchExchangeRates();
  }

  /**
   * Force refresh exchange rates
   */
  async refreshRates(): Promise<ExchangeRates> {
    return fetchExchangeRates(true);
  }

  /**
   * Pre-warm the exchange rate cache
   * Call this at startup to ensure rates are available
   */
  async warmCache(): Promise<void> {
    await fetchExchangeRates();
  }

  /**
   * Format cost for display
   */
  formatCost(cost: ApiCallCost): string {
    return [
      `Model: ${cost.model}`,
      `Tokens: ${cost.inputTokens.toLocaleString()} in / ${cost.outputTokens.toLocaleString()} out`,
      `Cost: $${cost.usd.toFixed(6)} USD`,
      `      ${cost.sol.toFixed(9)} SOL`,
      `      ${cost.slashbot.toFixed(2)} $SLASHBOT`,
    ].join('\n');
  }
}

// Singleton instance
let pricingServiceInstance: PricingService | null = null;

/**
 * Get the pricing service singleton
 */
export function getPricingService(): PricingService {
  if (!pricingServiceInstance) {
    pricingServiceInstance = new PricingService();
  }
  return pricingServiceInstance;
}

/**
 * Initialize pricing service with custom config
 */
export function initPricingService(config: Partial<PricingConfig>): PricingService {
  pricingServiceInstance = new PricingService(config);
  return pricingServiceInstance;
}
