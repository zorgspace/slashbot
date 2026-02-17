/**
 * @module providers/groq
 *
 * Groq LLM provider implementation. Registers Llama 3.3 70B, Llama 3.1 8B,
 * Mixtral 8x7B, and Gemma 2 9B models with API-key authentication.
 * Groq specializes in ultra-fast inference via custom LPU hardware.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Groq provider definition with all supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Groq
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('groq', 'Groq', [
    { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', contextWindow: 128_000, priority: 1, capabilities: ['chat', 'tools'] },
    { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools'] },
    { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B', contextWindow: 32_768, priority: 3, capabilities: ['chat', 'tools'] },
    { id: 'gemma2-9b-it', displayName: 'Gemma 2 9B', contextWindow: 8_192, priority: 4, capabilities: ['chat'] },
  ], pluginId);
}
