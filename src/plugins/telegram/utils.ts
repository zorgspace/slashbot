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
