import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('azure', 'Azure OpenAI', [
    { id: 'gpt-5', displayName: 'GPT-5 (Azure)', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
  ], pluginId);
}
