import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('deepseek', 'DeepSeek', [
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning'] },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'reasoning', 'thinking'] },
  ], pluginId);
}
