import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('perplexity', 'Perplexity', [
    { id: 'sonar-pro', displayName: 'Sonar Pro', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'search'] },
    { id: 'sonar', displayName: 'Sonar', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'search'] },
  ], pluginId);
}
