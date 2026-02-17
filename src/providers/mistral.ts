/**
 * @module providers/mistral
 *
 * Mistral AI LLM provider implementation. Registers Mistral Large, Pixtral Large,
 * Mistral Small, and Codestral models with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Mistral AI provider definition with all supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Mistral AI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('mistral', 'Mistral', [
    { id: 'mistral-large-latest', displayName: 'Mistral Large', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'pixtral-large-latest', displayName: 'Pixtral Large', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
    { id: 'mistral-small-latest', displayName: 'Mistral Small', contextWindow: 128_000, priority: 3, capabilities: ['chat', 'tools'] },
    { id: 'codestral-latest', displayName: 'Codestral', contextWindow: 256_000, priority: 4, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
