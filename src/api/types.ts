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
