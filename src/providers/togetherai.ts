/**
 * @module providers/togetherai
 *
 * Together.ai LLM provider implementation. Registers Llama 3.3 70B Turbo
 * and DeepSeek R1 models hosted on Together.ai with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Together.ai provider definition with supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Together.ai
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('togetherai', 'Together.ai', [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
    { id: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'reasoning', 'thinking'] },
  ], pluginId);
}
