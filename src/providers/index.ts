/**
 * @module providers/index
 *
 * Barrel module that aggregates all built-in LLM provider modules and exposes
 * a single factory function to instantiate every provider definition at once.
 *
 * @see {@link createAllProviders} -- Factory that returns all provider definitions
 */

import type { ProviderDefinition } from '../core/kernel/contracts.js';

import * as gateway from './gateway-provider.js';
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';
import * as xai from './xai.js';
import * as google from './google.js';
import * as mistral from './mistral.js';
import * as deepseek from './deepseek.js';
import * as groq from './groq.js';
import * as cerebras from './cerebras.js';
import * as cohere from './cohere.js';
import * as fireworks from './fireworks.js';
import * as deepinfra from './deepinfra.js';
import * as perplexity from './perplexity.js';
import * as togetherai from './togetherai.js';
import * as amazonBedrock from './amazon-bedrock.js';
import * as azure from './azure.js';
import * as googleVertex from './google-vertex.js';
import * as ollama from './ollama.js';
import * as vllm from './vllm.js';

/** All built-in provider modules, imported and collected for batch instantiation. */
const providerModules = [
  gateway,
  anthropic,
  openai,
  xai,
  google,
  mistral,
  deepseek,
  groq,
  cerebras,
  cohere,
  fireworks,
  deepinfra,
  perplexity,
  togetherai,
  amazonBedrock,
  azure,
  googleVertex,
  ollama,
  vllm,
] as const;

/**
 * Creates all built-in provider definitions by invoking each module's
 * `createProvider` factory.
 *
 * @param pluginId - The plugin identifier that owns these providers
 * @returns An array of {@link ProviderDefinition} for every registered LLM provider
 */
export function createAllProviders(pluginId: string): ProviderDefinition[] {
  return providerModules.map(m => m.createProvider(pluginId));
}
