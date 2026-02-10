/**
 * LLM API Types
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
  /** For tool-result messages: the tool call IDs and results */
  toolResults?: Array<{ toolCallId: string; toolName: string; result: string }>;
  /** For assistant messages with tool calls: raw AI SDK format for history replay */
  _rawAIMessage?: any;
}

export interface LLMConfig {
  provider: string;
  model?: string;
  modelImage?: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Backwards compatibility alias */
export type GrokConfig = LLMConfig;

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
 * A tool call returned by the AI SDK
 */
export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Options for the streaming API call
 */
export interface StreamOptions {
  showThinking?: boolean;
  displayStream?: boolean;
  timeout?: number;
  thinkingLabel?: string;
  /** AI SDK tools map to pass to generateText(). When set, enables native tool calling. */
  tools?: Record<string, any>;
}

/**
 * Result from a streaming API call
 */
export interface StreamResult {
  content: string;
  thinking: string;
  finishReason: string | null;
  /** Whether the model made tool calls that were executed via AI SDK execute callbacks */
  hasToolCalls: boolean;
  /** Full response messages from AI SDK (assistant + tool-result pairs) for history reconstruction */
  responseMessages?: any[];
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
 * LLMClient implements this to pass its state without exposing private fields.
 */
export interface ClientContext {
  authProvider: ApiAuthProvider;
  sessionManager: import('./sessions').SessionScope;
  config: LLMConfig;
  usage: UsageStats;
  thinkingActive: boolean;
  abortController: AbortController | null;
  rawOutputCallback: ((text: string) => void) | null;
  actionHandlers: import('../actions').ActionHandlers;
  providerRegistry: import('../../plugins/providers/registry').ProviderRegistry;
  toolRegistry: import('./toolRegistry').ToolRegistry | null;
  getModel(): string;
  getProvider(): string;
  estimateTokens(): number;
}
