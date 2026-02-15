import { randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderDefinition, ProviderModel, StructuredLogger } from '../kernel/contracts.js';
import type { ProviderRegistry } from '../kernel/registries.js';
import { registerProvider, getProviderFactory } from '../agentic/llm/provider-registry.js';
import type { ProvidersFileConfig, ProviderConfigEntry } from './providers-config.js';

// ---------------------------------------------------------------------------
// Apply user providers config to the running kernel
// ---------------------------------------------------------------------------

export function applyProvidersConfig(
  config: ProvidersFileConfig,
  providerRegistry: ProviderRegistry,
  logger: StructuredLogger,
): void {
  for (const [providerId, entry] of Object.entries(config.providers)) {
    const existing = providerRegistry.get(providerId);

    if (existing) {
      applyToExistingProvider(existing, entry, providerRegistry, logger);
    } else if (entry.type === 'openai-compatible') {
      registerCustomProvider(providerId, entry, providerRegistry, logger);
    } else {
      logger.warn('providers.json: unknown provider without type, skipping', { providerId });
    }
  }
}

// ---------------------------------------------------------------------------
// Override an existing (hardcoded) provider
// ---------------------------------------------------------------------------

function applyToExistingProvider(
  existing: ProviderDefinition,
  entry: ProviderConfigEntry,
  providerRegistry: ProviderRegistry,
  logger: StructuredLogger,
): void {
  const providerId = existing.id;

  // Merge models: user models replace by ID, unmentioned models kept
  if (entry.models && entry.models.length > 0) {
    const userModelIds = new Set(entry.models.map((m) => m.id));
    const kept = existing.models.filter((m) => !userModelIds.has(m.id));
    const userModels: ProviderModel[] = entry.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      priority: m.priority,
      capabilities: m.capabilities,
    }));
    existing.models = [...userModels, ...kept];
  }

  // Override display name
  if (entry.displayName) {
    existing.displayName = entry.displayName;
  }

  // Re-register provider definition (upsert to replace)
  providerRegistry.upsert(existing);

  // Override CompletionConfig in the LLM provider registry
  if (entry.config) {
    registerProvider(providerId, getExistingFactory(providerId), {
      ...(entry.config.temperature !== undefined ? { temperature: entry.config.temperature } : {}),
      ...(entry.config.maxTokens !== undefined ? { maxTokens: entry.config.maxTokens } : {}),
      ...(entry.config.contextLimit !== undefined ? { contextLimit: entry.config.contextLimit } : {}),
    });
  }

  logger.info('providers.json: updated existing provider', {
    providerId,
    modelsOverridden: entry.models?.length ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Register a new openai-compatible custom provider
// ---------------------------------------------------------------------------

function registerCustomProvider(
  providerId: string,
  entry: ProviderConfigEntry,
  providerRegistry: ProviderRegistry,
  logger: StructuredLogger,
): void {
  const baseUrl = entry.baseUrl;
  if (!baseUrl) {
    logger.warn('providers.json: custom provider missing baseUrl, skipping', { providerId });
    return;
  }

  const models: ProviderModel[] = (entry.models ?? []).map((m) => ({
    id: m.id,
    displayName: m.displayName,
    contextWindow: m.contextWindow,
    priority: m.priority,
    capabilities: m.capabilities,
  }));

  // Register in ProviderRegistry (kernel-level definition)
  const definition: ProviderDefinition = {
    id: providerId,
    pluginId: 'providers-config',
    displayName: entry.displayName ?? providerId,
    models,
    authHandlers: [{
      method: 'api_key',
      start: async () => ({
        method: 'api_key' as const,
        instructions: `Paste your API key for ${entry.displayName ?? providerId}.`,
      }),
      complete: async (context, input) => {
        if (!input.apiKey) {
          throw new Error(`Missing API key for ${providerId}`);
        }
        return {
          profileId: randomUUID(),
          providerId,
          label: `${context.profileLabel} (API key)`,
          method: 'api_key' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: { apiKey: input.apiKey },
        };
      },
    }],
    preferredAuthOrder: ['api_key'],
  };
  providerRegistry.upsert(definition);

  // Register SDK factory using createOpenAI with baseURL
  const factory = (execution: { token: string; modelId: string; baseUrl?: string; customFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }) => {
    const provider = createOpenAI({
      apiKey: execution.token,
      baseURL: execution.baseUrl ?? baseUrl,
      ...(execution.customFetch ? { fetch: execution.customFetch } : {}),
    });
    return provider(execution.modelId);
  };

  registerProvider(providerId, factory, {
    temperature: entry.config?.temperature ?? 0,
    maxTokens: entry.config?.maxTokens ?? 2048,
    ...(entry.config?.contextLimit !== undefined ? { contextLimit: entry.config.contextLimit } : {}),
  });

  logger.info('providers.json: registered custom openai-compatible provider', {
    providerId,
    baseUrl,
    modelCount: models.length,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExistingFactory(providerId: string) {
  const existing = getProviderFactory(providerId);
  if (!existing) {
    throw new Error(`Cannot override config for unregistered provider: ${providerId}`);
  }
  return existing;
}
