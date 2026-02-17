/**
 * @module providers/shared
 *
 * Shared utilities for LLM provider definitions. Provides reusable factory
 * functions for API-key-based and base-URL-based authentication handlers,
 * as well as a convenience helper to build a complete {@link ProviderDefinition}.
 *
 * @see {@link createApiKeyAuthHandler} -- API-key auth handler factory
 * @see {@link createBaseUrlAuthHandler} -- Base-URL auth handler factory
 * @see {@link defineProvider} -- Convenience provider definition builder
 */

import { randomUUID } from 'node:crypto';
import type {
  AuthCompleteInput,
  AuthProfile,
  AuthStartContext,
  AuthStartResult,
  ProviderAuthHandler,
  ProviderDefinition,
  ProviderModel,
} from '../core/kernel/contracts.js';

/**
 * Creates an authentication handler that prompts the user for an API key.
 *
 * @param providerId - Unique identifier for the provider (e.g. `"openai"`)
 * @param displayName - Human-readable provider name shown in prompts
 * @returns A {@link ProviderAuthHandler} configured for API-key authentication
 */
export function createApiKeyAuthHandler(providerId: string, displayName: string): ProviderAuthHandler {
  return {
    method: 'api_key',
    start: async (_context: AuthStartContext): Promise<AuthStartResult> => ({
      method: 'api_key',
      instructions: `Paste your ${displayName} API key.`,
    }),
    complete: async (context: AuthStartContext, input: AuthCompleteInput): Promise<AuthProfile> => {
      if (!input.apiKey) throw new Error(`Missing ${displayName} API key`);
      return {
        profileId: randomUUID(),
        providerId,
        label: `${context.profileLabel} (API key)`,
        method: 'api_key',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { apiKey: input.apiKey },
      };
    },
  };
}

/**
 * Creates an authentication handler that accepts either a base URL or an API key.
 * Used by self-hosted providers (e.g. Ollama, vLLM) where the endpoint may vary.
 *
 * @param providerId - Unique identifier for the provider
 * @param displayName - Human-readable provider name shown in prompts
 * @param defaultBaseUrl - Default base URL used when the user supplies only an API key
 * @returns A {@link ProviderAuthHandler} configured for base-URL or API-key authentication
 */
export function createBaseUrlAuthHandler(
  providerId: string,
  displayName: string,
  defaultBaseUrl: string,
): ProviderAuthHandler {
  return {
    method: 'api_key',
    start: async (_context: AuthStartContext): Promise<AuthStartResult> => ({
      method: 'api_key',
      instructions: `Enter your ${displayName} base URL (default: ${defaultBaseUrl}), or paste an API key if required.`,
    }),
    complete: async (context: AuthStartContext, input: AuthCompleteInput): Promise<AuthProfile> => {
      const value = input.apiKey ?? '';
      const isUrl = value.startsWith('http://') || value.startsWith('https://');
      return {
        profileId: randomUUID(),
        providerId,
        label: `${context.profileLabel} (${isUrl ? 'base URL' : 'API key'})`,
        method: 'api_key',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: isUrl
          ? { baseUrl: value, apiKey: 'ollama' }
          : { baseUrl: defaultBaseUrl, apiKey: value || 'ollama' },
      };
    },
  };
}

/**
 * Builds a complete {@link ProviderDefinition} with standard API-key auth.
 *
 * @param id - Unique provider identifier (e.g. `"anthropic"`)
 * @param displayName - Human-readable name for the provider
 * @param models - Array of models offered by this provider
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A fully populated {@link ProviderDefinition}
 */
export function defineProvider(
  id: string,
  displayName: string,
  models: ProviderModel[],
  pluginId: string,
): ProviderDefinition {
  return {
    id,
    pluginId,
    displayName,
    models,
    authHandlers: [createApiKeyAuthHandler(id, displayName)],
    preferredAuthOrder: ['api_key'],
  };
}
