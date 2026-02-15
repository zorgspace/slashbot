import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('mistral', 'Mistral', [
    { id: 'mistral-large-latest', displayName: 'Mistral Large', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'pixtral-large-latest', displayName: 'Pixtral Large', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
    { id: 'mistral-small-latest', displayName: 'Mistral Small', contextWindow: 128_000, priority: 3, capabilities: ['chat', 'tools'] },
    { id: 'codestral-latest', displayName: 'Codestral', contextWindow: 256_000, priority: 4, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
