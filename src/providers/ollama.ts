/**
 * @module providers/ollama
 *
 * Ollama LLM provider implementation for locally hosted models. Registers
 * Llama 3.3 70B, Qwen 2.5 32B, DeepSeek R1 32B, Mistral 7B, and
 * Code Llama 34B models with base-URL authentication (defaults to
 * `http://localhost:11434/v1`).
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { createBaseUrlAuthHandler } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Ollama provider definition with locally hosted models.
 * Uses base-URL auth so users can point to a custom Ollama instance.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Ollama
 */
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
