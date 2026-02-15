import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('amazon-bedrock', 'Amazon Bedrock', [
    { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', displayName: 'Claude 3.5 Sonnet (Bedrock)', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'tools', 'image'] },
    { id: 'amazon.nova-pro-v1:0', displayName: 'Amazon Nova Pro', contextWindow: 300_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
