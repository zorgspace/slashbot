/**
 * @module llm
 *
 * Public barrel export for the LLM subsystem. Re-exports all types,
 * the VoltAgent adapter, provider registry functions, helper utilities,
 * and context pipeline components used by the agentic layer.
 */
export type {
  AgentMessage,
  AgentTextPart,
  AgentImagePart,
  AgentMessagePart,
  AgentMessageContent,
  ToolCallInfo,
  ToolCallMessage,
  ToolResultMessage,
  RichMessage,
  LlmCompletionInput,
  StreamingCallback,
  LlmAdapter,
  TokenModeProxyResolution,
  TokenModeProxyAuthService,
  TokenModeProxyResolver,
  CompletionConfig,
  CompletionExecution,
  AgentToolAction,
  AgentLoopCallbacks,
  AgentLoopResult,
} from './types.js';

export { VoltAgentAdapter } from '../../voltagent/index.js';

export {
  registerProvider,
  getProviderFactory,
  getProviderConfig,
  registerBuiltinProviders,
} from './provider-registry.js';

export {
  contentToText,
  estimateTokens,
  estimateMessageTokens,
} from './helpers.js';

export type { ContextPipelineConfig, ContextPipelineResult } from '../context/types.js';
export {
  defaultPipelineConfig,
  prepareContext,
  withOverflowRecovery,
  truncateToolResult,
} from '../context/index.js';
