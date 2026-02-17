/**
 * @module providers/cerebras
 *
 * Cerebras LLM provider implementation. Registers Llama 3.3 70B and
 * Llama 3.1 8B models with API-key authentication. Cerebras uses custom
 * wafer-scale chips for high-throughput inference.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Cerebras provider definition with supported Llama models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Cerebras
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('cerebras', 'Cerebras', [
    { id: 'llama3.3-70b', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
    { id: 'llama3.1-8b', displayName: 'Llama 3.1 8B', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
