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
  /** Proxy mode: use slashbot-web proxy with wallet billing */
  proxyUrl?: string;
  /** Wallet address for proxy billing */
  walletAddress?: string;
  /** Payment mode: 'apikey' or 'token' */
  paymentMode?: string;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

/** Billing info returned by proxy */
export interface BillingInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: {
    usd: number;
    credits: number;
  };
  processingTime: number;
}

/** Balance info from proxy */
export interface BalanceInfo {
  walletAddress: string;
  credits: number;
  lastUpdated: string;
}
