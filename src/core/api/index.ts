/**
 * LLM API Client
 * Re-exports all API components from modular files
 */

// Types
export type {
  Message,
  LLMConfig,
  GrokConfig,
  UsageStats,
  ApiAuthProvider,
  StreamOptions,
  StreamResult,
  AgenticLoopOptions,
  AgenticLoopResult,
  ExecutionPolicy,
  ExecutionPolicyMode,
  ClientContext,
} from './types';

// Auth
export { DirectAuthProvider, DEFAULT_CONFIG } from '../../plugins/providers/auth';

// Utilities
export { compressActionResults, getEnvironmentInfo } from './utils';
export { LRUCache } from './utils';

// Sessions
export { SessionManager } from './sessions';
export type {
  ConversationSession,
  SessionUsageStats,
  SessionCompactionStats,
  ContextPressurePolicy,
  ContextPressureResult,
} from './sessions';

// Client
export { LLMClient, GrokClient, createGrokClient, createLLMClient } from './client';
export type { ActionHandlers } from './client';

// Providers
export { ProviderRegistry } from '../../plugins/providers/registry';
export type { ProviderConfig } from '../../plugins/providers/registry';
export type { ProviderInfo, ModelInfo, ProviderCapabilities } from '../../plugins/providers/types';
export {
  PROVIDERS,
  MODELS as MODEL_CATALOG,
  getModelsForProvider,
  getModelInfo,
  inferProvider,
} from '../../plugins/providers/models';
