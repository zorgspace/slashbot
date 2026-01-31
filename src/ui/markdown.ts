/**
 * Terminal Markdown Renderer
 * Converts markdown to ANSI-styled terminal output
 */

import { colors } from './colors';

// ANSI codes
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const STRIKETHROUGH = '\x1b[9m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

/**
 * Render markdown to terminal-styled string
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove form feed and other control characters that cause blank pages
  result = result.replace(/[\f\v]/g, '');

  // Strip ANSI screen-clearing sequences that might come from external content
  result = result.replace(/\x1b\[\??\d*[JHK]/g, '');

  // Normalize excessive newlines (max 2 consecutive)
  result = result.replace(/\n{3,}/g, '\n\n');

  // Code blocks (```...```) - preserve content, add dim styling
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const lines = code.trim().split('\n');
    const formatted = lines.map((line: string) => `${DIM}│${RESET} ${line}`).join('\n');
    return `${DIM}┌─────────${RESET}\n${formatted}\n${DIM}└─────────${RESET}`;
  });

  // Inline code (`...`)
  result = result.replace(/`([^`]+)`/g, `${DIM}${CYAN}$1${RESET}`);

  // Headers
  result = result.replace(/^### (.+)$/gm, `${BOLD}${YELLOW}   $1${RESET}`);
  result = result.replace(/^## (.+)$/gm, `${BOLD}${YELLOW}  $1${RESET}`);
  result = result.replace(/^# (.+)$/gm, `${BOLD}${YELLOW}━━ $1 ━━${RESET}`);

  // Bold (**text** or __text__)
  result = result.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  result = result.replace(/__([^_]+)__/g, `${BOLD}$1${RESET}`);

  // Italic (*text* or _text_) - be careful not to match list items
  result = result.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, `${ITALIC}$1${RESET}`);
  result = result.replace(/(?<!_)_([^_\n]+)_(?!_)/g, `${ITALIC}$1${RESET}`);

  // Strikethrough (~~text~~)
  result = result.replace(/~~([^~]+)~~/g, `${STRIKETHROUGH}$1${RESET}`);

  // Links [text](url) - show text with underline, url in dim
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `${UNDERLINE}${CYAN}$1${RESET}${DIM} ($2)${RESET}`,
  );

  // Bullet lists
  result = result.replace(/^(\s*)[-*] (.+)$/gm, `$1${GREEN}•${RESET} $2`);

  // Numbered lists
  result = result.replace(/^(\s*)(\d+)\. (.+)$/gm, `$1${GREEN}$2.${RESET} $3`);

  // Blockquotes
  result = result.replace(/^> (.+)$/gm, `${DIM}│${RESET} ${ITALIC}$1${RESET}`);

  // Horizontal rules
  result = result.replace(/^(---|___|\*\*\*)$/gm, `${DIM}────────────────────${RESET}`);

  // Trim leading/trailing whitespace
  return result.trim();
}

/**
 * Print markdown to stdout with formatting
 */
export function printMarkdown(text: string): void {
  console.log(renderMarkdown(text));
}
