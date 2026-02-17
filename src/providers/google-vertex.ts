/**
 * @module providers/google-vertex
 *
 * Google Vertex AI LLM provider implementation. Registers Gemini 2.5 Pro
 * and Gemini 2.0 Flash models accessed through the Vertex AI platform
 * with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Google Vertex AI provider definition with supported Gemini models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Google Vertex AI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('google-vertex', 'Google Vertex AI', [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Vertex)', contextWindow: 1_000_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Vertex)', contextWindow: 1_000_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
