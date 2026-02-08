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

/**
 * Options for the streaming API call
 */
export interface StreamOptions {
  showThinking?: boolean;
  displayStream?: boolean;
  timeout?: number;
  thinkingLabel?: string;
}

/**
 * Result from a streaming API call
 */
export interface StreamResult {
  content: string;
  thinking: string;
  finishReason: string | null;
}

/**
 * Options for the agentic loop
 */
export interface AgenticLoopOptions {
  displayStream: boolean;
  maxIterations: number;
  iterationTimeout?: number;
  overallTimeout?: number;
  cacheFileContents: boolean;
  includeFileContext: boolean;
  tokenLimitStrategy: 'condense' | 'abort';
  hallucinationDetection: 'full' | 'basic';
  emptyResponseRetry: boolean;
  editTagDebug: boolean;
  continueActions: boolean;
  maxConsecutiveErrors?: number;
}

/**
 * Result from the agentic loop
 */
export interface AgenticLoopResult {
  finalResponse: string;
  finalThinking: string;
  executedActions: Array<{ type: string; description: string; success: boolean }>;
  actionsSummary: string[];
  timedOut: boolean;
  earlyReturn?: string;
  endMessage?: string;
}

/**
 * Internal context interface for extracted streaming/loop functions.
 * GrokClient implements this to pass its state without exposing private fields.
 */
export interface ClientContext {
  authProvider: ApiAuthProvider;
  sessionManager: import('./sessions').SessionManager;
  config: GrokConfig;
  usage: UsageStats;
  thinkingActive: boolean;
  abortController: AbortController | null;
  rawOutputCallback: ((text: string) => void) | null;
  actionHandlers: import('../actions').ActionHandlers;
  getModel(): string;
  estimateTokens(): number;
}
