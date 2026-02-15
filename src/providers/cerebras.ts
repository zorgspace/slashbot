import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('cerebras', 'Cerebras', [
    { id: 'llama3.3-70b', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
    { id: 'llama3.1-8b', displayName: 'Llama 3.1 8B', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
