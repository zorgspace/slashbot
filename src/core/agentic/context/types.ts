import type { AgentMessage } from '../llm/types.js';

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

export interface ContextPipelineResult {
  messages: AgentMessage[];
  trimmed: boolean;
  pruned: boolean;
  estimatedTokens: number;
}
