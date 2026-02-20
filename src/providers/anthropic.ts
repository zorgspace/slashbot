/**
 * @module providers/anthropic
 *
 * Anthropic LLM provider implementation. Registers Claude Opus 4.6,
 * Opus 4.5, Sonnet 4.5, Sonnet 4.0, and Haiku 4.5 models with
 * OAuth PKCE (preferred) and API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { createApiKeyAuthHandler } from './shared.js';
import { createAnthropicOAuthHandler } from './anthropic-oauth.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Anthropic provider definition with all supported Claude models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Anthropic
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return {
    id: 'anthropic',
    pluginId,
    displayName: 'Anthropic',
    models: [
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
      { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', contextWindow: 200_000, priority: 2, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
      { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', contextWindow: 200_000, priority: 3, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
      { id: 'claude-sonnet-4-0', displayName: 'Claude Sonnet 4.0', contextWindow: 200_000, priority: 4, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
      { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: 200_000, priority: 5, capabilities: ['chat', 'tools', 'image'] },
    ],
    authHandlers: [
      createAnthropicOAuthHandler(),
      createApiKeyAuthHandler('anthropic', 'Anthropic'),
    ],
    preferredAuthOrder: ['oauth_pkce', 'api_key'],
  };
}
