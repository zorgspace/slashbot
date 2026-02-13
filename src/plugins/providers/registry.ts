/**
 * Provider Registry - Maps provider IDs to Vercel AI SDK model instances
 */

import type { LanguageModel } from 'ai';
import { PROVIDERS, inferProvider } from './models';
import type { ProviderInfo } from './types';

type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProviderFactory = (
  apiKey: string,
  baseUrl?: string,
  headers?: Record<string, string>,
  customFetch?: ProviderFetch,
) => (modelId: string) => LanguageModel;

/**
 * Lazy-loaded provider SDK factories.
 * Each returns a function that creates a model reference.
 */
const providerFactories: Record<string, ProviderFactory> = {
  xai: (apiKey, baseUrl, headers, customFetch) => {
    const { createXai } = require('@ai-sdk/xai');
    const provider = createXai({
      apiKey,
      baseURL: baseUrl,
      ...(headers ? { headers } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
  anthropic: (apiKey, baseUrl, headers, customFetch) => {
    const { createAnthropic } = require('@ai-sdk/anthropic');
    const provider = createAnthropic({
      apiKey,
      baseURL: baseUrl,
      ...(headers ? { headers } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
  openai: (apiKey, baseUrl, headers, customFetch) => {
    const { createOpenAI } = require('@ai-sdk/openai');
    const provider = createOpenAI({
      apiKey,
      baseURL: baseUrl,
      ...(headers ? { headers } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
  google: (apiKey, baseUrl, headers, customFetch) => {
    const { createGoogleGenerativeAI } = require('@ai-sdk/google');
    const provider = createGoogleGenerativeAI({
      apiKey,
      baseURL: baseUrl,
      ...(headers ? { headers } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
};

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: ProviderFetch;
}

export class ProviderRegistry {
  private configs = new Map<string, ProviderConfig>();
  private modelFactories = new Map<string, (modelId: string) => LanguageModel>();

  /**
   * Configure a provider with its API key and optional base URL
   */
  configure(providerId: string, config: ProviderConfig): void {
    this.configs.set(providerId, config);
    // Invalidate cached factory so it gets recreated with new config
    this.modelFactories.delete(providerId);
  }

  /**
   * Get a model reference for the given provider and model ID
   */
  getModel(providerId: string, modelId: string): LanguageModel {
    let factory = this.modelFactories.get(providerId);

    if (!factory) {
      const config = this.configs.get(providerId);
      if (!config) {
        throw new Error(`Provider '${providerId}' not configured. Set the API key first.`);
      }

      const factoryFn = providerFactories[providerId];
      if (!factoryFn) {
        throw new Error(
          `Unknown provider '${providerId}'. Available: ${Object.keys(providerFactories).join(', ')}`,
        );
      }

      try {
        factory = factoryFn(config.apiKey, config.baseUrl, config.headers, config.fetch);
      } catch (err: any) {
        console.error(
          `[Provider Error] Failed to create ${providerId} factory:`,
          err.message,
          err.stack,
        );
        throw err;
      }
      this.modelFactories.set(providerId, factory);
    }

    try {
      return factory(modelId);
    } catch (err: any) {
      console.error(
        `[Provider Error] Failed to create model '${modelId}' for ${providerId}:`,
        err.message,
        err.stack,
      );
      throw err;
    }
  }

  /**
   * Resolve a model reference, auto-detecting provider if needed
   */
  resolveModel(modelId: string, providerHint?: string): LanguageModel {
    const providerId = providerHint || inferProvider(modelId);
    if (!providerId) {
      throw new Error(`Cannot determine provider for model '${modelId}'. Specify a provider.`);
    }
    return this.getModel(providerId, modelId);
  }

  /**
   * Get the raw config (apiKey, baseUrl) for a provider
   */
  getConfig(providerId: string): ProviderConfig | undefined {
    return this.configs.get(providerId);
  }

  /**
   * Check if a provider is configured
   */
  isConfigured(providerId: string): boolean {
    return this.configs.has(providerId);
  }

  /**
   * Get all configured provider IDs
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get provider info
   */
  getProviderInfo(providerId: string): ProviderInfo | undefined {
    return PROVIDERS[providerId];
  }

  /**
   * Get all known providers (configured or not)
   */
  getAllProviders(): ProviderInfo[] {
    return Object.values(PROVIDERS);
  }
}
