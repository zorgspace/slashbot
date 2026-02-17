/**
 * @module providers/deepinfra
 *
 * DeepInfra LLM provider implementation. Registers Llama 3.3 70B hosted
 * on the DeepInfra inference platform with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the DeepInfra provider definition with supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for DeepInfra
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('deepinfra', 'DeepInfra', [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
