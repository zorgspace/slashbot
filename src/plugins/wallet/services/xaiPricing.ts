/**
 * xAI Model Pricing
 * Official pricing from https://docs.x.ai/docs/models
 * Prices are in USD per million tokens
 */

import type { ModelPricing } from './types';

/** xAI model pricing table (USD per million tokens) */
export const XAI_MODEL_PRICING: ModelPricing[] = [
  // Grok 4 models
  {
    model: 'grok-4-1-fast-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  {
    model: 'grok-4-1-fast-non-reasoning',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
  },
  // Code models
  {
    model: 'grok-code-fast-1',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.5,
  },
];

/** Default pricing for unknown models */
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  model: 'default',
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 3.0,
};

/**
 * Get pricing for a specific model
 * Returns default pricing if model is not found
 */
export function getModelPricing(model: string): ModelPricing {
  // Try exact match first
  const exactMatch = XAI_MODEL_PRICING.find(p => p.model === model);
  if (exactMatch) return exactMatch;

  // Try partial match (model name contains)
  const partialMatch = XAI_MODEL_PRICING.find(
    p =>
      model.toLowerCase().includes(p.model.toLowerCase()) ||
      p.model.toLowerCase().includes(model.toLowerCase()),
  );
  if (partialMatch) return { ...partialMatch, model };

  // Return default with the requested model name
  return { ...DEFAULT_MODEL_PRICING, model };
}

/**
 * Calculate base cost in USD for an API call
 * @param model - Model identifier
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost in USD
 */
export function calculateBaseUsdCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  return inputCost + outputCost;
}
