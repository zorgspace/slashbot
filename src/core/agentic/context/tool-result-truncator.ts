import type { ContextPipelineConfig } from './types.js';

/**
 * Truncate a single tool result string to fit within context budget.
 * Prefers cutting on newline boundaries when possible.
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
