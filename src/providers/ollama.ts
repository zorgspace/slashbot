import { createBaseUrlAuthHandler } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return {
    id: 'ollama',
    pluginId,
    displayName: 'Ollama',
    models: [
      { id: 'llama3.3:70b', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
      { id: 'qwen2.5:32b', displayName: 'Qwen 2.5 32B', contextWindow: 32_768, priority: 2, capabilities: ['chat', 'tools'] },
      { id: 'deepseek-r1:32b', displayName: 'DeepSeek R1 32B', contextWindow: 128_000, priority: 3, capabilities: ['chat', 'reasoning'] },
      { id: 'mistral:7b', displayName: 'Mistral 7B', contextWindow: 32_768, priority: 4, capabilities: ['chat'] },
      { id: 'codellama:34b', displayName: 'Code Llama 34B', contextWindow: 16_384, priority: 5, capabilities: ['chat', 'tools'] },
    ],
    authHandlers: [createBaseUrlAuthHandler('ollama', 'Ollama', 'http://localhost:11434/v1')],
    preferredAuthOrder: ['api_key'],
  };
}
