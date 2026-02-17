/**
 * @module context/constants
 *
 * Default constants and configuration factory for the context preparation
 * pipeline. Defines thresholds for tool result truncation, context pruning,
 * overflow recovery, and the protected message zone.
 *
 * @see {@link defaultPipelineConfig} — Factory for default pipeline configuration
 */
import type { ContextPipelineConfig } from './types.js';
import { RESERVE_TOKENS_DEFAULT, DEFAULT_CONTEXT_TOKENS } from '../llm/helpers.js';

/** Maximum fraction of the context window a single tool result may occupy (30%). */
export const TOOL_RESULT_MAX_CONTEXT_SHARE = 0.30;
/** Hard ceiling on tool result character count (400K chars). */
export const TOOL_RESULT_HARD_MAX = 400_000;
/** Minimum characters to preserve when truncating a tool result. */
export const TOOL_RESULT_MIN_KEEP = 2_000;

/** Budget usage fraction at which soft-trim activates for old tool results. */
export const SOFT_TRIM_THRESHOLD = 0.30;
/** Budget usage fraction at which hard-clear replaces old tool results with placeholders. */
export const HARD_CLEAR_THRESHOLD = 0.50;
/** Character count above which a tool result is eligible for soft-trim. */
export const SOFT_TRIM_MIN_CHARS = 4_000;
/** Characters to keep at head and tail when soft-trimming a tool result. */
export const SOFT_TRIM_KEEP_CHARS = 1_500;

/** Number of recent assistant messages protected from pruning. */
export const PROTECTED_RECENT_MESSAGES = 3;

/** Maximum retry attempts for overflow recovery before giving up. */
export const OVERFLOW_MAX_RETRIES = 3;
/** Fraction of context limit added to reserve tokens during aggressive overflow trim. */
export const OVERFLOW_AGGRESSIVE_TRIM_FACTOR = 0.25;

/**
 * Creates a default pipeline configuration with sensible defaults for all thresholds.
 *
 * @param contextLimit - Total model context window in tokens (defaults to 128K)
 * @param reserveTokens - Tokens reserved for response and tool round-trips (defaults to 20K)
 * @returns A complete ContextPipelineConfig with all fields populated
 */
export function defaultPipelineConfig(
  contextLimit: number = DEFAULT_CONTEXT_TOKENS,
  reserveTokens: number = RESERVE_TOKENS_DEFAULT,
): ContextPipelineConfig {
  return {
    contextLimit,
    reserveTokens,
    toolResultMaxContextShare: TOOL_RESULT_MAX_CONTEXT_SHARE,
    toolResultHardMax: TOOL_RESULT_HARD_MAX,
    toolResultMinKeep: TOOL_RESULT_MIN_KEEP,
    softTrimThreshold: SOFT_TRIM_THRESHOLD,
    hardClearThreshold: HARD_CLEAR_THRESHOLD,
    softTrimMinChars: SOFT_TRIM_MIN_CHARS,
    softTrimKeepChars: SOFT_TRIM_KEEP_CHARS,
    protectedRecentMessages: PROTECTED_RECENT_MESSAGES,
    maxHistoryTurns: 0,
  };
}
