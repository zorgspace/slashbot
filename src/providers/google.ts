/**
 * @module providers/google
 *
 * Google AI (Gemini) LLM provider implementation. Registers Gemini 2.5 Pro,
 * Gemini 2.5 Flash, and Gemini 2.0 Flash models with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Google AI provider definition with all supported Gemini models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Google AI
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('google', 'Google', [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1_000_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'search', 'thinking'] },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1_000_000, priority: 2, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1_000_000, priority: 3, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
