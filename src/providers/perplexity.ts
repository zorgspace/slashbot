/**
 * @module providers/perplexity
 *
 * Perplexity AI LLM provider implementation. Registers Sonar Pro and Sonar
 * models with API-key authentication. Perplexity models specialize in
 * search-augmented generation.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Perplexity AI provider definition with all supported Sonar models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Perplexity AI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('perplexity', 'Perplexity', [
    { id: 'sonar-pro', displayName: 'Sonar Pro', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'search'] },
    { id: 'sonar', displayName: 'Sonar', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'search'] },
  ], pluginId);
}
