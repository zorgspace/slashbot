/**
 * Say Handler - Display messages to the user with markdown rendering
 */

import type { SayAction, ActionResult } from '../types';
import { c } from '../../ui/colors';

/**
 * Simple markdown renderer for terminal output
 */
function renderMarkdown(text: string): string {
  let result = text;

  // Headers (# ## ###)
  result = result.replace(/^### (.*$)/gim, `${c.cyan(c.bold('### $1'))}`);
  result = result.replace(/^## (.*$)/gim, `${c.yellow(c.bold('## $1'))}`);
  result = result.replace(/^# (.*$)/gim, `${c.violet(c.bold('# $1'))}`);

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.*?)\*\*/g, `${c.bold('$1')}`);
  result = result.replace(/__(.*?)__/g, `${c.bold('$1')}`);

  // Italic (*text* or _text_)
  result = result.replace(/\*(.*?)\*/g, `${c.italic('$1')}`);
  result = result.replace(/_(.*?)_/g, `${c.italic('$1')}`);

  // Inline code (`code`)
  result = result.replace(/`([^`\n]+)`/g, `${c.bgGray(c.white(' $1 '))}`);

  // Code blocks (```language\ncode\n```)
  result = result.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const langLabel = lang ? ` ${lang}` : '';
    const codeLines = code.trim().split('\n');
    const maxWidth = Math.max(...codeLines.map(line => line.length)) + 4;
    const topBorder = '┌' + '─'.repeat(maxWidth - 2) + '┐';
    const bottomBorder = '└' + '─'.repeat(maxWidth - 2) + '┘';

    let formatted = `${c.cyan(topBorder)}\n`;
    formatted += `${c.cyan('│')}${c.muted(langLabel.padEnd(maxWidth - 2))}${c.cyan('│')}\n`;
    formatted += `${c.cyan('├')}${c.muted('─'.repeat(maxWidth - 2))}${c.cyan('┤')}\n`;

    for (const line of codeLines) {
      formatted += `${c.cyan('│')} ${c.white(line.padEnd(maxWidth - 4))} ${c.cyan('│')}\n`;
    }

    formatted += `${c.cyan(bottomBorder)}\n`;
    return formatted;
  });

  // Lists (- item or * item or 1. item)
  result = result.replace(/^[-*] (.*$)/gim, `${c.violet('•')} $1`);
  result = result.replace(/^\d+\. (.*$)/gim, (match, content) => `${c.violet(match)}`);

  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${c.blue(c.underline('$1'))}${c.muted(' ($2)')}`);

  // Strikethrough (~~text~~)
  result = result.replace(/~~(.*?)~~/g, `${c.strikethrough('$1')}`);

  // Blockquotes (> text)
  result = result.replace(/^> (.*$)/gim, `${c.muted('│ $1')}`);

  return result;
}

/**
 * Execute a say action - renders markdown for terminal display
 */
export async function executeSay(action: SayAction): Promise<ActionResult> {
  const renderedMessage = renderMarkdown(action.message);

  return {
    action: 'Say',
    success: true,
    result: renderedMessage,
  };
}
