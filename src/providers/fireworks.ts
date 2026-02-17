/**
 * @module providers/fireworks
 *
 * Fireworks AI LLM provider implementation. Registers Llama 3.3 70B hosted
 * on the Fireworks inference platform with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Fireworks AI provider definition with supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Fireworks AI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('fireworks', 'Fireworks', [
    { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
