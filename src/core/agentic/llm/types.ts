/**
 * @module llm/types
 *
 * Core type definitions for the LLM subsystem. Defines message formats
 * (including multimodal content and rich tool-chain messages), completion
 * input/output shapes, streaming callbacks, the adapter interface, token-mode
 * proxy types for wallet-based auth, and completion runner dependencies.
 *
 * @see {@link LlmAdapter} — Primary adapter interface for completions
 * @see {@link LlmCompletionInput} — Input shape for all completion calls
 * @see {@link RichMessage} — Union type for tool-chain history messages
 */
import type { AuthProfileRouter } from '../../providers/auth-router.js';
import type { StructuredLogger } from '../../kernel/contracts.js';
import type { ProviderRegistry } from '../../kernel/registries.js';

// ---------------------------------------------------------------------------
// Agent loop types (previously in agent-loop.ts, moved here after migration)
// ---------------------------------------------------------------------------

/** Represents a single tool invocation during the agent loop, tracking its lifecycle. */
export interface AgentToolAction {
  /** Unique identifier for this action instance. */
  id: string;
  /** Human-readable display name of the tool. */
  name: string;
  /** Description of what the tool does. */
  description: string;
  /** Canonical tool identifier from the kernel registry. */
  toolId: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Current lifecycle status of the tool action. */
  status: 'running' | 'done' | 'error';
  /** Serialized result output when status is 'done'. */
  result?: string;
  /** Error message when status is 'error'. */
  error?: string;
}

/** Callbacks for observing the progress and events of an agent loop execution. */
export interface AgentLoopCallbacks {
  /** Called when a conversation title is derived from the first LLM response line. */
  onTitle?(title: string): void;
  /** Called with the LLM text output at each step of the loop. */
  onThoughts?(text: string, stepIndex: number): void;
  /** Called when a tool invocation begins. */
  onToolStart?(action: AgentToolAction): void;
  /** Called when a tool invocation completes (success or error). */
  onToolEnd?(action: AgentToolAction): void;
  /** Called when a tool produces user-facing output (dual-track forUser content). */
  onToolUserOutput?(toolId: string, content: string): void;
  /** Called with a compact summary of the final response text. */
  onSummary?(summary: string): void;
  /** Called when the agent loop finishes with the final result. */
  onDone?(result: AgentLoopResult): void;
}

/** Result returned by the agent loop upon completion. */
export interface AgentLoopResult {
  /** Final text response from the LLM. */
  text: string;
  /** Number of LLM generation steps performed. */
  steps: number;
  /** Total number of tool calls made across all steps. */
  toolCalls: number;
  /** Reason the loop terminated (e.g. 'stop', 'error', 'abort'). */
  finishReason: string;
  /** Full tool chain from the loop, for rich history persistence. */
  messages?: RichMessage[];
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** A single message in the agent conversation. */
export interface AgentMessage {
  /** The role of the message sender. */
  role: 'system' | 'user' | 'assistant';
  /** Message content: plain string or array of text/image parts. */
  content: AgentMessageContent;
}

/** A text content part within a multimodal message. */
export type AgentTextPart = { type: 'text'; text: string };
/** An image content part within a multimodal message. */
export type AgentImagePart = { type: 'image'; image: string; mimeType?: string };
/** A single part of a multimodal message (text or image). */
export type AgentMessagePart = AgentTextPart | AgentImagePart;
/** Message content: either a plain string or an array of multimodal parts. */
export type AgentMessageContent = string | AgentMessagePart[];

// ---------------------------------------------------------------------------
// Rich message types (tool chain history)
// ---------------------------------------------------------------------------

/** Information about a single tool call made by the assistant. */
export interface ToolCallInfo {
  /** Unique call identifier for correlating with results. */
  id: string;
  /** Name of the tool being called. */
  name: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
}

/** An assistant message that includes one or more tool call invocations. */
export interface ToolCallMessage {
  role: 'assistant';
  /** Optional text content accompanying the tool calls. */
  content: AgentMessageContent;
  /** Tool calls made in this message. */
  toolCalls: ToolCallInfo[];
}

/** A tool result message containing the output of a tool call. */
export interface ToolResultMessage {
  role: 'tool';
  /** The ID of the tool call this result corresponds to. */
  toolCallId: string;
  /** Serialized result content from the tool execution. */
  content: string;
}

/** Union type representing any message in a rich tool-chain conversation history. */
export type RichMessage = AgentMessage | ToolCallMessage | ToolResultMessage;

/** Input parameters for an LLM completion request. */
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

/** Callbacks for receiving streaming completion output token-by-token. */
export interface StreamingCallback {
  /** Called with each token delta as it arrives. */
  onToken(delta: string): void;
  /** Called when the stream completes with the full assembled text. */
  onComplete(fullText: string): void;
  /** Called when an error occurs during streaming. */
  onError(error: Error): void;
}

/** Adapter interface for LLM completions, supporting both full and streaming modes. */
export interface LlmAdapter {
  /** Runs a full agentic completion with optional tool use and callbacks. */
  complete(input: LlmCompletionInput, callbacks?: AgentLoopCallbacks): Promise<AgentLoopResult>;
  /** Runs a streaming completion that pipes tokens through a callback. */
  streamComplete?(input: LlmCompletionInput, callback: StreamingCallback): Promise<void>;
}

// ---------------------------------------------------------------------------
// Token-mode proxy types (wallet-based auth)
// ---------------------------------------------------------------------------

/** Result of resolving a token-mode proxy request. */
export interface TokenModeProxyResolution {
  /** Whether the proxy is enabled and usable. */
  enabled: boolean;
  /** Base URL for the proxied API endpoint. */
  baseUrl?: string;
  /** Headers to attach to proxied requests. */
  headers?: Record<string, string>;
  /** Human-readable reason when the proxy is not available. */
  reason?: string;
}

/** Service that resolves proxy requests for wallet-based token mode auth. */
export interface TokenModeProxyAuthService {
  /** Resolves proxy configuration for a given request body. */
  resolveProxyRequest(requestBody: string): Promise<TokenModeProxyResolution>;
}

/** A proxy auth service instance or a factory function that produces one. */
export type TokenModeProxyResolver = TokenModeProxyAuthService | (() => TokenModeProxyAuthService | undefined);

// ---------------------------------------------------------------------------
// Completion types
// ---------------------------------------------------------------------------

/** Configuration for a completion request to a specific provider. */
export interface CompletionConfig {
  /** Sampling temperature (0 = deterministic, higher = more random). */
  temperature: number;
  /** Maximum output tokens for the response. */
  maxTokens: number;
  /** Timeout in milliseconds for the completion request. */
  timeoutMs: number;
  /** Max input context size in tokens. When set, messages are trimmed to fit before the API call. */
  contextLimit?: number;
}

/** A resolved execution target for a single completion attempt. */
export interface CompletionExecution {
  /** Provider identifier (e.g. 'openai', 'anthropic'). */
  providerId: string;
  /** Model identifier to use for this execution. */
  modelId: string;
  /** API key or access token for authentication. */
  token: string;
  /** Optional custom base URL for the API endpoint. */
  baseUrl?: string;
  /** Optional custom fetch function (used for proxy routing). */
  customFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Profile ID used for this execution (for failure reporting). */
  profileId?: string;
}

// ---------------------------------------------------------------------------
// Completion runner dependencies
// ---------------------------------------------------------------------------

/** Runtime dependencies injected into the completion runner and agent loop. */
export interface RunCompletionDeps {
  /** Auth profile router for resolving provider credentials. */
  authRouter: AuthProfileRouter;
  /** Registry of available LLM providers. */
  providers: ProviderRegistry;
  /** Structured logger for diagnostics. */
  logger: StructuredLogger;
  /** Resolves the token-mode proxy service (wallet-based auth). */
  resolveTokenModeProxy: () => TokenModeProxyAuthService | undefined;
  /** Selects the best model for a provider, optionally preferring a specific model. */
  selectModelForProvider: (providerId: string, preferredModelId?: string) => string | undefined;
}
