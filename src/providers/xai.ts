import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('xai', 'xAI', [
    { id: 'grok-4.1-fast-reasoning', displayName: 'Grok 4.1 Fast Reasoning', contextWindow: 131_072, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'grok-4.1-fast-non-reasoning', displayName: 'Grok 4.1 Fast Non-Reasoning', contextWindow: 131_072, priority: 2, capabilities: ['chat', 'tools', 'image'] },
    { id: 'grok-4-fast-reasoning', displayName: 'Grok 4 Fast Reasoning', contextWindow: 131_072, priority: 3, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'grok-4-fast-non-reasoning', displayName: 'Grok 4 Fast Non-Reasoning', contextWindow: 131_072, priority: 4, capabilities: ['chat', 'tools', 'image'] },
    { id: 'grok-4', displayName: 'Grok 4', contextWindow: 131_072, priority: 5, capabilities: ['chat', 'tools', 'reasoning', 'image', 'search'] },
    { id: 'grok-3', displayName: 'Grok 3', contextWindow: 131_072, priority: 6, capabilities: ['chat', 'tools', 'reasoning', 'image', 'search'] },
    { id: 'grok-3-fast', displayName: 'Grok 3 Fast', contextWindow: 131_072, priority: 7, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'grok-3-mini', displayName: 'Grok 3 Mini', contextWindow: 131_072, priority: 8, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'grok-3-mini-fast', displayName: 'Grok 3 Mini Fast', contextWindow: 131_072, priority: 9, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'grok-code-fast-1', displayName: 'Grok Code Fast 1', contextWindow: 131_072, priority: 10, capabilities: ['chat', 'tools'] },
    { id: 'grok-2-vision', displayName: 'Grok 2 Vision', contextWindow: 32_768, priority: 11, capabilities: ['chat', 'image'] },
  ], pluginId);
}
