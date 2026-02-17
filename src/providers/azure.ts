/**
 * @module providers/azure
 *
 * Azure OpenAI LLM provider implementation. Registers GPT-5 accessed through
 * the Azure OpenAI Service with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Azure OpenAI provider definition with supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Azure OpenAI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('azure', 'Azure OpenAI', [
    { id: 'gpt-5', displayName: 'GPT-5 (Azure)', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
  ], pluginId);
}
