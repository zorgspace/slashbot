/**
 * @module context/types
 *
 * Type definitions for the context preparation pipeline. Defines the
 * configuration interface controlling all pipeline stages (history limiting,
 * pruning, trimming, sanitization) and the result interface returned
 * after processing.
 *
 * @see {@link ContextPipelineConfig} — Full pipeline configuration
 * @see {@link ContextPipelineResult} — Pipeline output with metadata
 */
import type { AgentMessage } from '../llm/types.js';

/** Configuration controlling all stages of the context preparation pipeline. */
export interface ContextPipelineConfig {
  /** Total model context window in tokens. */
  contextLimit: number;
  /** Tokens reserved for response + tool round-trips. */
  reserveTokens: number;
  /** Max share of context a single tool result may occupy (0-1). */
  toolResultMaxContextShare: number;
  /** Hard ceiling on tool result character count. */
  toolResultHardMax: number;
  /** Minimum characters to keep when truncating a tool result. */
  toolResultMinKeep: number;
  /** Budget usage fraction at which soft-trim activates. */
  softTrimThreshold: number;
  /** Budget usage fraction at which hard-clear activates. */
  hardClearThreshold: number;
  /** Character count above which a tool result is eligible for soft-trim. */
  softTrimMinChars: number;
  /** Characters to keep at head/tail when soft-trimming. */
  softTrimKeepChars: number;
  /** Number of recent assistant messages protected from pruning. */
  protectedRecentMessages: number;
  /** Maximum number of user turns to keep (0 = unlimited). */
  maxHistoryTurns: number;
  /** Provider ID for provider-specific sanitization rules. */
  providerId?: string;
}

/** Result returned by the context preparation pipeline. */
export interface ContextPipelineResult {
  /** The processed messages ready for LLM submission. */
  messages: AgentMessage[];
  /** Whether messages were trimmed to fit the token budget. */
  trimmed: boolean;
  /** Whether old tool results were pruned (soft-trim or hard-clear). */
  pruned: boolean;
  /** Estimated token count of the processed messages. */
  estimatedTokens: number;
}
