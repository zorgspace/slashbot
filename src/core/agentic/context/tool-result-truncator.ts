/**
 * @module context/tool-result-truncator
 *
 * Truncates individual tool result strings to fit within the configured
 * context budget share. Prefers cutting on newline boundaries for cleaner
 * output. Used by the tool bridge to cap tool output before feeding it
 * back to the LLM.
 *
 * @see {@link truncateToolResult} — Main truncation function
 */
import type { ContextPipelineConfig } from './types.js';

/**
 * Truncates a single tool result string to fit within the context budget share.
 * The maximum character limit is derived from contextLimit * toolResultMaxContextShare,
 * capped by toolResultHardMax. Prefers cutting on newline boundaries when possible
 * to preserve readability.
 *
 * @param result - The raw tool result string to truncate
 * @param config - Configuration with context limit and truncation thresholds
 * @returns The original string if within limits, or a truncated version with a suffix indicator
 */
export function truncateToolResult(
  result: string,
  config: Pick<ContextPipelineConfig, 'contextLimit' | 'toolResultMaxContextShare' | 'toolResultHardMax' | 'toolResultMinKeep'>,
): string {
  const maxChars = Math.min(
    Math.floor(config.contextLimit * 4 * config.toolResultMaxContextShare),
    config.toolResultHardMax,
  );

  if (result.length <= maxChars) return result;

  const keepChars = Math.max(config.toolResultMinKeep, maxChars);
  const effectiveLimit = Math.min(result.length, keepChars);

  // Try to cut on a newline boundary within the last 200 chars of the limit
  const searchStart = Math.max(0, effectiveLimit - 200);
  const lastNewline = result.lastIndexOf('\n', effectiveLimit);
  const cutPoint = lastNewline > searchStart ? lastNewline : effectiveLimit;

  return result.slice(0, cutPoint) + `\n\n[... truncated ${result.length - cutPoint} characters ...]`;
}
