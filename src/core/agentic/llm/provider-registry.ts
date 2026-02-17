/**
 * @module llm/provider-registry
 *
 * Global registry mapping provider IDs to AI SDK model factories and
 * completion configurations. Registers built-in providers (OpenAI, Anthropic,
 * xAI, Google, Ollama, vLLM) at module load time and supports dynamic
 * registration of gateway vendors.
 *
 * @see {@link registerProvider} — Register a custom provider factory
 * @see {@link getProviderFactory} — Retrieve a provider's model factory
 * @see {@link getProviderConfig} — Retrieve a provider's completion config
 * @see {@link registerBuiltinProviders} — Re-register all built-in providers
 * @see {@link registerGatewayVendor} — Dynamically register an OpenAI-compatible gateway vendor
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { CompletionConfig, CompletionExecution } from './types.js';

// ---------------------------------------------------------------------------
// Provider factory type
// ---------------------------------------------------------------------------

type ProviderFactory = (execution: CompletionExecution) => ReturnType<typeof import('ai')['generateText']> extends Promise<infer _> ? unknown : unknown;

// We define the factory as a function that takes execution opts and returns a
// provider-model object compatible with the AI SDK's `model` parameter.
type ProviderModelFactory = (execution: CompletionExecution) => unknown;

interface ProviderEntry {
  factory: ProviderModelFactory;
  config: CompletionConfig;
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const registry = new Map<string, ProviderEntry>();

const DEFAULT_CONFIG: CompletionConfig = { temperature: 0, maxTokens: 2048, timeoutMs: 600_000 };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers a provider in the global registry with its model factory and config.
 *
 * @param providerId - Unique identifier for the provider (e.g. 'openai', 'anthropic')
 * @param factory - Function that creates an AI SDK model from an execution object
 * @param config - Optional partial config merged with defaults (temperature, maxTokens, timeoutMs)
 */
export function registerProvider(
  providerId: string,
  factory: ProviderModelFactory,
  config?: Partial<CompletionConfig>
): void {
  registry.set(providerId, {
    factory,
    config: { ...DEFAULT_CONFIG, ...config },
  });
}

/**
 * Retrieves the model factory for a registered provider.
 *
 * @param providerId - The provider identifier to look up
 * @returns The provider's model factory, or undefined if not registered
 */
export function getProviderFactory(providerId: string): ProviderModelFactory | undefined {
  return registry.get(providerId)?.factory;
}

/**
 * Retrieves the completion config for a registered provider.
 * Falls back to DEFAULT_CONFIG if the provider is not registered.
 *
 * @param providerId - The provider identifier to look up
 * @returns The provider's completion config
 */
export function getProviderConfig(providerId: string): CompletionConfig {
  return registry.get(providerId)?.config ?? DEFAULT_CONFIG;
}

// ---------------------------------------------------------------------------
// Built-in SDK factory — builds a provider-model from an execution object
// ---------------------------------------------------------------------------

function buildProviderModel(sdkFactory: Function) {
  return (execution: CompletionExecution) => {
    const opts = {
      apiKey: execution.token,
      ...(execution.baseUrl ? { baseURL: execution.baseUrl } : {}),
      ...(execution.customFetch ? { fetch: execution.customFetch } : {}),
    };
    return sdkFactory(opts)(execution.modelId);
  };
}

// ---------------------------------------------------------------------------
// Register built-in providers
// ---------------------------------------------------------------------------

/**
 * Registers all built-in LLM providers (OpenAI, Anthropic, xAI, Google,
 * Ollama, vLLM) with their default configurations. Called automatically
 * at module load time as a side effect.
 */
export function registerBuiltinProviders(): void {
  registerProvider('openai', buildProviderModel(createOpenAI), {
    temperature: 0.6,
    maxTokens: 3072,
    contextLimit: 128_000,
  });

  registerProvider('anthropic', buildProviderModel(createAnthropic), {
    temperature: 0,
    maxTokens: 3072,
    contextLimit: 200_000,
  });

  registerProvider('xai', buildProviderModel(createXai), {
    temperature: 0,
    maxTokens: 4096,
    contextLimit: 128_000,
  });

  registerProvider('google', buildProviderModel(createGoogleGenerativeAI), {
    temperature: 0,
    maxTokens: 3072,
    contextLimit: 1_000_000,
  });

  // Local LLM providers (OpenAI-compatible API)
  registerProvider('ollama', buildProviderModel(createOpenAI), {
    temperature: 0,
    maxTokens: 2048,
    contextLimit: 128_000,
  });

  registerProvider('vllm', buildProviderModel(createOpenAI), {
    temperature: 0,
    maxTokens: 2048,
    contextLimit: 32_768,
  });
}

/**
 * Register a gateway vendor using the OpenAI-compatible Vercel AI Gateway.
 * Called dynamically when the gateway catalog discovers vendors not already registered.
 */
export function registerGatewayVendor(vendorId: string): void {
  if (registry.has(vendorId)) return;
  registerProvider(vendorId, buildProviderModel(createOpenAI), {
    temperature: 0,
    maxTokens: 2048,
    contextLimit: 128_000,
  });
}

// Side-effect: register builtins at module load time
registerBuiltinProviders();
