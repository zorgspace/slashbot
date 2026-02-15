import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('google-vertex', 'Google Vertex AI', [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Vertex)', contextWindow: 1_000_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Vertex)', contextWindow: 1_000_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
