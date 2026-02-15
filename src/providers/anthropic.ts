import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('anthropic', 'Anthropic', [
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', contextWindow: 200_000, priority: 2, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', contextWindow: 200_000, priority: 3, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'claude-sonnet-4-0', displayName: 'Claude Sonnet 4.0', contextWindow: 200_000, priority: 4, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: 200_000, priority: 5, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
