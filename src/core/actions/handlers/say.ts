/**
 * Say Handler - Display messages to the user with markdown rendering
 */

import type { SayAction, ActionResult, ActionHandlers } from '../types';
import { executeNotify } from './scheduling';
import { c, step } from '../../ui/colors';

/**
 * Decode basic HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Simple markdown renderer for terminal output
 */
function renderMarkdown(text: string): string {
  let result = decodeHtmlEntities(text);

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
 * Execute a say action - renders markdown for terminal display, or sends to target platform
 */
export async function executeSay(action: SayAction, handlers?: ActionHandlers): Promise<ActionResult> {
  if (action.target && handlers?.onNotify) {
    // Send to target platform (don't call step.say() - connector will show the result)
    const result = await handlers.onNotify(action.message.trim(), action.target);
    return {
      action: 'Says',
      success: true,
      result: `Message sent to ${action.target}: ${result.sent.join(', ')}${result.failed.length ? ` (failed: ${result.failed.join(', ')})` : ''}`,
    };
  }

  // Default: render markdown for terminal display
  // Don't show step.say() here - the rendered message will be displayed by the caller
  const renderedMessage = renderMarkdown(action.message.trim());
  return {
    action: 'Says',
    success: true,
    result: renderedMessage,
  };
}
