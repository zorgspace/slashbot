/**
 * @module voltagent
 *
 * VoltAgent integration layer for Slashbot. Provides a drop-in LlmAdapter
 * replacement backed by VoltAgent's Agent class with auth resolution,
 * tool bridging, and multi-agent support.
 */
export { VoltAgentAdapter } from './adapter.js';
export { resolveModel, type ResolveModelOptions, type LanguageModelLike } from './failover-model.js';
export { createResolvedModel } from './model-factory.js';
export {
  buildVoltAgentTools,
  sanitizeToolName,
  deriveToolDisplayName,
  type ToolBridgeCallbacks,
  type ToolBridgeToolMeta,
} from './tool-bridge.js';
export { createVoltAgentFromSpec } from './agent-factory.js';
