/**
 * Grok API Types
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface GrokConfig {
  apiKey: string;
  model?: string;
  modelImage?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

/**
 * Auth provider interface for pluggable authentication strategies.
 * Default: direct API key auth. Billing plugin provides proxy auth.
 */
export interface ApiAuthProvider {
  /** Get the API endpoint URL */
  getEndpoint(): string;
  /** Get auth headers for a request */
  getHeaders(requestBody: string): Record<string, string>;
  /** Called before each request (e.g. to validate token balance) */
  beforeRequest?(): Promise<void>;
  /** Called for each parsed SSE chunk (e.g. to capture billing info) */
  onStreamChunk?(parsed: any): void;
}
