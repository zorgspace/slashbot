import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('togetherai', 'Together.ai', [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
    { id: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'reasoning', 'thinking'] },
  ], pluginId);
}
