import type { TelegramChatRef } from './types.js';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractCommandPayload(text: string, commands: string[]): string | null {
  const trimmed = text.trim();
  for (const raw of commands) {
    const command = raw.startsWith('/') ? raw : `/${raw}`;
    const pattern = new RegExp(`^${escapeRegExp(command)}(?:@[\\w_]+)?(?:\\s+([\\s\\S]+))?$`, 'i');
    const match = trimmed.match(pattern);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}

export function trimForUiEvent(text: string, maxLen = 2000): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...[truncated]`;
}

export function extractRetryAfterMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = /retry after (\d+)/i.exec(msg);
  if (match) return (Number(match[1]) + 1) * 1000;
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryMs = extractRetryAfterMs(err);
      if (retryMs && attempt < maxRetries) {
        await sleep(retryMs);
        continue;
      }
      throw err;
    }
  }
}

export function parseAgentRouting(text: string): { agentId?: string; message: string } {
  const match = text.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
  if (match) return { agentId: match[1].toLowerCase(), message: match[2].trim() };
  return { message: text };
}

export function resolveChatContext(chat: TelegramChatRef): { chatId: string; contextKey: string; sessionId: string } {
  const chatId = String(chat.id);
  const chatType = typeof chat.type === 'string' && chat.type.length > 0 ? chat.type : 'unknown';
  return {
    chatId,
    contextKey: `tg:${chatType}:${chatId}`,
    sessionId: `tg-${chatType}-${chatId}`,
  };
}

export function isPrivateChatId(chatId: string): boolean {
  const n = Number(chatId);
  return Number.isNaN(n) || n >= 0;
}

/**
 * Convert standard markdown to Telegram-compatible HTML.
 * Handles code blocks, inline code, bold, italic, and links.
 * Much more reliable than Telegram's legacy Markdown parse mode.
 */
export function markdownToTelegramHtml(md: string): string {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Extract code blocks first to protect their content
  const codeBlocks: string[] = [];
  let text = md.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_m, code: string) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Escape HTML in remaining text
  text = escHtml(text);

  // Bold **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic *text* or _text_
  text = text.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<i>$1</i>');

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore inline code
  text = text.replace(/\x00IC(\d+)\x00/g, (_m, i: string) =>
    `<code>${escHtml(inlineCodes[Number(i)])}</code>`);

  // Restore code blocks
  text = text.replace(/\x00CB(\d+)\x00/g, (_m, i: string) =>
    `<pre>${escHtml(codeBlocks[Number(i)])}</pre>`);

  return text;
}
