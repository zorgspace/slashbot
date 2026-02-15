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
] as const;

/** Create all built-in provider definitions. */
export function createAllProviders(pluginId: string): ProviderDefinition[] {
  return providerModules.map(m => m.createProvider(pluginId));
}
