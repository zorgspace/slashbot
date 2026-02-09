/**
 * API Authentication - Default auth provider and config defaults
 */

import { GROK_CONFIG } from '../config/constants';
import type { GrokConfig, ApiAuthProvider } from './types';

export const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: GROK_CONFIG.MODEL,
  modelImage: GROK_CONFIG.MODEL_VISION,
  baseUrl: GROK_CONFIG.API_BASE_URL,
  maxTokens: GROK_CONFIG.MAX_TOKENS,
  temperature: GROK_CONFIG.TEMPERATURE,
};

/**
 * Default auth provider: direct API key auth against xAI
 */
export class DirectAuthProvider implements ApiAuthProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  getEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  getHeaders(_requestBody: string): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}
