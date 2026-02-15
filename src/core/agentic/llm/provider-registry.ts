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

const DEFAULT_CONFIG: CompletionConfig = { temperature: 0, maxTokens: 2048, timeoutMs: 60_000 };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

export function getProviderFactory(providerId: string): ProviderModelFactory | undefined {
  return registry.get(providerId)?.factory;
}

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
