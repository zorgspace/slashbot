import { createBaseUrlAuthHandler } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

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
