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
