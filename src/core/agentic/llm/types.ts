import type { AuthProfileRouter } from '../../providers/auth-router.js';
import type { StructuredLogger } from '../../kernel/contracts.js';
import type { ProviderRegistry } from '../../kernel/registries.js';
import type { AgentLoopCallbacks, AgentLoopResult } from '../agent-loop.js';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: AgentMessageContent;
}

export type AgentTextPart = { type: 'text'; text: string };
export type AgentImagePart = { type: 'image'; image: string; mimeType?: string };
export type AgentMessagePart = AgentTextPart | AgentImagePart;
export type AgentMessageContent = string | AgentMessagePart[];

// ---------------------------------------------------------------------------
// Rich message types (tool chain history)
// ---------------------------------------------------------------------------

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallMessage {
  role: 'assistant';
  content: AgentMessageContent;
  toolCalls: ToolCallInfo[];
}

export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
}

export type RichMessage = AgentMessage | ToolCallMessage | ToolResultMessage;

export interface LlmCompletionInput {
  sessionId: string;
  agentId: string;
  messages: AgentMessage[];
  abortSignal?: AbortSignal;
  maxTokens?: number;
  maxSteps?: number;
  /** When true, no tools are passed to the LLM — pure text completion. */
  noTools?: boolean;
  /** Pin a specific provider for this completion (bypasses default routing). */
  pinnedProviderId?: string;
  /** Pin a specific model for this completion (overrides resolved model). */
  pinnedModelId?: string;
  /** Restrict tools available to the LLM to this allowlist of tool IDs. */
  toolAllowlist?: string[];
  /** Exclude specific tools by ID. */
  toolDenylist?: string[];
}

export interface StreamingCallback {
  onToken(delta: string): void;
  onComplete(fullText: string): void;
  onError(error: Error): void;
}

export interface LlmAdapter {
  complete(input: LlmCompletionInput, callbacks?: AgentLoopCallbacks): Promise<AgentLoopResult>;
  streamComplete?(input: LlmCompletionInput, callback: StreamingCallback): Promise<void>;
}

// ---------------------------------------------------------------------------
// Token-mode proxy types (wallet-based auth)
// ---------------------------------------------------------------------------

export interface TokenModeProxyResolution {
  enabled: boolean;
  baseUrl?: string;
  headers?: Record<string, string>;
  reason?: string;
}

export interface TokenModeProxyAuthService {
  resolveProxyRequest(requestBody: string): Promise<TokenModeProxyResolution>;
}

export type TokenModeProxyResolver = TokenModeProxyAuthService | (() => TokenModeProxyAuthService | undefined);

// ---------------------------------------------------------------------------
// Completion types
// ---------------------------------------------------------------------------

export interface CompletionConfig {
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Max input context size in tokens. When set, messages are trimmed to fit before the API call. */
  contextLimit?: number;
}

export interface CompletionExecution {
  providerId: string;
  modelId: string;
  token: string;
  baseUrl?: string;
  customFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Profile ID used for this execution (for failure reporting). */
  profileId?: string;
}

// ---------------------------------------------------------------------------
// Completion runner dependencies
// ---------------------------------------------------------------------------

export interface RunCompletionDeps {
  authRouter: AuthProfileRouter;
  providers: ProviderRegistry;
  logger: StructuredLogger;
  resolveTokenModeProxy: () => TokenModeProxyAuthService | undefined;
  selectModelForProvider: (providerId: string, preferredModelId?: string) => string | undefined;
}
