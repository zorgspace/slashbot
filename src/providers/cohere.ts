import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('cohere', 'Cohere', [
    { id: 'command-r-plus', displayName: 'Command R+', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'command-r', displayName: 'Command R', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools'] },
  ], pluginId);
}
