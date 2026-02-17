/**
 * @module providers/openai
 *
 * OpenAI LLM provider implementation. Registers GPT-5.2, GPT-5, GPT-5 Mini,
 * o3, o3 Mini, and o4 Mini models with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the OpenAI provider definition with all supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for OpenAI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('openai', 'OpenAI', [
    { id: 'gpt-5.2', displayName: 'GPT-5.2', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'gpt-5', displayName: 'GPT-5', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'gpt-5-mini', displayName: 'GPT-5 Mini', contextWindow: 128_000, priority: 3, capabilities: ['chat', 'tools', 'image'] },
    { id: 'o3', displayName: 'o3', contextWindow: 200_000, priority: 4, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'o3-mini', displayName: 'o3 Mini', contextWindow: 200_000, priority: 5, capabilities: ['chat', 'tools', 'reasoning', 'thinking'] },
    { id: 'o4-mini', displayName: 'o4 Mini', contextWindow: 200_000, priority: 6, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
  ], pluginId);
}
