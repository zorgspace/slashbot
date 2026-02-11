/**
 * formatToolAction - Build styled one-liners for tool action display
 *
 * Used by all executors to produce consistent, concise action summaries.
 */

import { t, fg, bold, type StyledText } from '@opentui/core';
import { theme } from './theme';

export interface ToolActionResult {
  success: boolean;
  summary?: string;
}

/**
 * Format a tool action into a styled one-liner.
 *
 * Examples:
 *   formatToolAction('Read', 'path.ts')                              → "Read - path.ts"
 *   formatToolAction('Read', 'path.ts', { success: true, summary: '42 lines' })
 *                                                                     → "Read - path.ts ✓ 42 lines"
 *   formatToolAction('Exec', 'ls', { success: false, summary: 'exit 1' })
 *                                                                     → "Exec - ls ✗ exit 1"
 */
export function formatToolAction(
  name: string,
  detail: string,
  result?: ToolActionResult,
): StyledText {
  const parts: StyledText[] = [t`${bold(fg(theme.accent)(name))} ${fg(theme.muted)('-')} ${detail}`];

  if (result) {
    if (result.success) {
      const summary = result.summary ? ` ${result.summary}` : '';
      parts.push(t` ${fg(theme.success)('\u2713' + summary)}`);
    } else {
      const summary = result.summary ? ` ${result.summary}` : '';
      parts.push(t` ${fg(theme.error)('\u2717' + summary)}`);
    }
  }

  // Merge all StyledText parts into one
  return { chunks: parts.flatMap(p => p.chunks) } as StyledText;
}

/**
 * Format just a tool name without detail (for tools with no args).
 */
export function formatToolName(name: string, result?: ToolActionResult): StyledText {
  const parts: StyledText[] = [t`${bold(fg(theme.accent)(name))}`];

  if (result) {
    if (result.success) {
      const summary = result.summary ? ` ${result.summary}` : '';
      parts.push(t` ${fg(theme.success)('\u2713' + summary)}`);
    } else {
      const summary = result.summary ? ` ${result.summary}` : '';
      parts.push(t` ${fg(theme.error)('\u2717' + summary)}`);
    }
  }

  return { chunks: parts.flatMap(p => p.chunks) } as StyledText;
}
