export function parseAgentRouting(text: string): { agentId?: string; message: string } {
  const match = text.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
  if (match) return { agentId: match[1].toLowerCase(), message: match[2].trim() };
  return { message: text };
}

export function trimForUiEvent(text: string, maxLen = 2000): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...[truncated]`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDMChannel(guildId: string | null | undefined): boolean {
  return !guildId;
}

export function resolveChatContext(
  channelId: string,
  guildId: string | null | undefined,
): { channelId: string; contextKey: string; sessionId: string } {
  const chatType = isDMChannel(guildId) ? 'dm' : 'guild';
  return {
    channelId,
    contextKey: `dc:${chatType}:${channelId}`,
    sessionId: `dc-${chatType}-${channelId}`,
  };
}

export function extractRetryAfterMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = /retry after (\d+)/i.exec(msg);
  if (match) return (Number(match[1]) + 1) * 1000;
  return null;
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
