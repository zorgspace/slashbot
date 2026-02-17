/**
 * @module providers/vllm
 *
 * vLLM provider implementation for self-hosted model serving. Registers a
 * single default model slot with base-URL authentication (defaults to
 * `http://localhost:8000/v1`). Users point this at their running vLLM instance.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { createBaseUrlAuthHandler } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the vLLM provider definition with a default model placeholder.
 * Uses base-URL auth so users can point to a custom vLLM endpoint.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for vLLM
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return {
    id: 'vllm',
    pluginId,
    displayName: 'vLLM',
    models: [
      { id: 'default', displayName: 'vLLM Default Model', contextWindow: 32_768, priority: 1, capabilities: ['chat', 'tools'] },
    ],
    authHandlers: [createBaseUrlAuthHandler('vllm', 'vLLM', 'http://localhost:8000/v1')],
    preferredAuthOrder: ['api_key'],
  };
}
