import type { ContextPipelineConfig } from './types.js';
import { RESERVE_TOKENS_DEFAULT, DEFAULT_CONTEXT_TOKENS } from '../llm/helpers.js';

// Tool result truncation
export const TOOL_RESULT_MAX_CONTEXT_SHARE = 0.30;
export const TOOL_RESULT_HARD_MAX = 400_000;
export const TOOL_RESULT_MIN_KEEP = 2_000;

// Context pruning thresholds (fraction of budget used)
export const SOFT_TRIM_THRESHOLD = 0.30;
export const HARD_CLEAR_THRESHOLD = 0.50;
export const SOFT_TRIM_MIN_CHARS = 4_000;
export const SOFT_TRIM_KEEP_CHARS = 1_500;

// Protected zone
export const PROTECTED_RECENT_MESSAGES = 3;

// Overflow recovery
export const OVERFLOW_MAX_RETRIES = 3;
export const OVERFLOW_AGGRESSIVE_TRIM_FACTOR = 0.25;

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
