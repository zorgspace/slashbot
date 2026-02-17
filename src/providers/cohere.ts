/**
 * @module providers/cohere
 *
 * Cohere LLM provider implementation. Registers Command R+ and Command R
 * models with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Cohere provider definition with all supported Command models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Cohere
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('cohere', 'Cohere', [
    { id: 'command-r-plus', displayName: 'Command R+', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'command-r', displayName: 'Command R', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
