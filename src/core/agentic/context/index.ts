/**
 * @module context
 *
 * Public barrel export for the context preparation subsystem. Re-exports
 * pipeline types, configuration factory, all pipeline stages (history limiter,
 * context pruner, message sanitizer, tool result truncator), the unified
 * pipeline entry point, and overflow recovery utilities.
 */
export type { ContextPipelineConfig, ContextPipelineResult } from './types.js';
export { defaultPipelineConfig } from './constants.js';
export { truncateToolResult } from './tool-result-truncator.js';
export { limitHistoryTurns } from './history-limiter.js';
export { pruneContextMessages } from './context-pruner.js';
export { sanitizeMessages } from './message-sanitizer.js';
export { prepareContext } from './pipeline.js';
export { withOverflowRecovery } from './overflow-recovery.js';
export type { OverflowRecoveryCallbacks } from './overflow-recovery.js';
