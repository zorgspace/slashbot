/**
 * Built-in model catalog with capabilities
 */

import type { ModelInfo, ProviderInfo } from './types';

export const PROVIDERS: Record<string, ProviderInfo> = {
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
    defaultModel: 'grok-code-fast-1',
    defaultImageModel: 'grok-4-1-fast-non-reasoning',
    baseUrl: 'https://api.x.ai/v1',
    capabilities: { vision: true, reasoning: true, streaming: true, maxTokens: 256000, maxOutputTokens: 131072 },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    envVars: ['ANTHROPIC_API_KEY'],
    defaultModel: 'claude-sonnet-4-5-20250929',
    capabilities: { vision: true, reasoning: true, streaming: true, maxTokens: 200000, maxOutputTokens: 64000 },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    envVars: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o',
    capabilities: { vision: true, reasoning: true, streaming: true, maxTokens: 128000, maxOutputTokens: 16384 },
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    envVars: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    defaultModel: 'gemini-2.0-flash',
    capabilities: { vision: true, reasoning: false, streaming: true, maxTokens: 1000000, maxOutputTokens: 65536 },
  },
};

export const MODELS: ModelInfo[] = [
  // xAI
  { id: 'grok-code-fast-1', provider: 'xai', name: 'Grok Code Fast', maxTokens: 256000, maxOutputTokens: 10000, vision: false, reasoning: true },
  { id: 'grok-4-1-fast-reasoning', provider: 'xai', name: 'Grok 4.1 Fast Reasoning', maxTokens: 256000, maxOutputTokens: 131072, vision: false, reasoning: true },
  { id: 'grok-4-1-fast-non-reasoning', provider: 'xai', name: 'Grok 4.1 Fast', maxTokens: 256000, maxOutputTokens: 131072, vision: true, reasoning: false },
  // Anthropic
  { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic', name: 'Claude Sonnet 4.5', maxTokens: 200000, maxOutputTokens: 64000, vision: true, reasoning: true },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', name: 'Claude Haiku 4.5', maxTokens: 200000, maxOutputTokens: 8192, vision: true, reasoning: false },
  { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', maxTokens: 200000, maxOutputTokens: 32000, vision: true, reasoning: true },
  // OpenAI
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', maxTokens: 128000, maxOutputTokens: 16384, vision: true, reasoning: false },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', maxTokens: 128000, maxOutputTokens: 16384, vision: true, reasoning: false },
  { id: 'o3-mini', provider: 'openai', name: 'o3-mini', maxTokens: 128000, maxOutputTokens: 100000, vision: false, reasoning: true },
  // Google
  { id: 'gemini-2.0-flash', provider: 'google', name: 'Gemini 2.0 Flash', maxTokens: 1000000, maxOutputTokens: 8192, vision: true, reasoning: false },
  { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', maxTokens: 1000000, maxOutputTokens: 65536, vision: true, reasoning: true },
];

/**
 * Get models available for a specific provider
 */
export function getModelsForProvider(providerId: string): ModelInfo[] {
  return MODELS.filter(m => m.provider === providerId);
}

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODELS.find(m => m.id === modelId);
}

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  providerName: string;
}

/**
 * Get a flat list of models across all given provider IDs, with provider metadata attached.
 */
export function getModelsForProviders(providerIds: string[]): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const pid of providerIds) {
    const providerName = PROVIDERS[pid]?.name || pid;
    for (const m of MODELS.filter(m => m.provider === pid)) {
      entries.push({ id: m.id, name: m.name, provider: pid, providerName });
    }
  }
  return entries;
}

/**
 * Infer provider from model ID
 */
export function inferProvider(modelId: string): string | undefined {
  const model = MODELS.find(m => m.id === modelId);
  if (model) return model.provider;
  // Heuristic fallback
  if (modelId.startsWith('grok-')) return 'xai';
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3') || modelId.startsWith('o1')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  return undefined;
}

/**
 * Infer provider from API key prefix
 */
export function inferProviderFromKey(apiKey: string): string | undefined {
  if (apiKey.startsWith('xai-')) return 'xai';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  if (apiKey.startsWith('AIza')) return 'google';
  return undefined;
}
