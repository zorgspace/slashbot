/**
 * API Authentication - Default auth provider and config defaults
 */

import { GROK_CONFIG } from '../../core/config/constants';
import type { LLMConfig, GrokConfig, ApiAuthProvider } from '../../core/api/types';

export const DEFAULT_CONFIG: Partial<LLMConfig> = {
  maxTokens: GROK_CONFIG.MAX_TOKENS,
  temperature: GROK_CONFIG.TEMPERATURE,
};

/**
 * Default auth provider: direct API key auth
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
