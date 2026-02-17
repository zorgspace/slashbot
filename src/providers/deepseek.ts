/**
 * @module providers/deepseek
 *
 * DeepSeek LLM provider implementation. Registers DeepSeek Chat and
 * DeepSeek Reasoner models with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the DeepSeek provider definition with all supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for DeepSeek
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('deepseek', 'DeepSeek', [
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'reasoning', 'thinking'] },
  ], pluginId);
}
