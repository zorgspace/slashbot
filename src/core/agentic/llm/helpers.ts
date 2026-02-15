import type { AuthProfile } from '../../kernel/contracts.js';
import type { AgentMessageContent } from './types.js';

/** Rough token count (chars / 4). Used for context budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contentToText(content: AgentMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : '[Image attached]'))
    .join('\n');
}

/** Token count for a single message (content + role overhead). */
export function estimateMessageTokens(message: { role: string; content: AgentMessageContent }): number {
  return estimateTokens(contentToText(message.content)) + 4;
}

/**
 * Reserve tokens for response and tool round-trips (openclaw: pi-settings DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR).
 */
export const RESERVE_TOKENS_DEFAULT = 20_000;

/** Minimum context window; below this we skip the model (openclaw: context-window-guard CONTEXT_WINDOW_HARD_MIN_TOKENS). */
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;

/** Warn when context window is below this (openclaw: CONTEXT_WINDOW_WARN_BELOW_TOKENS). */
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

/** Fallback context limit when provider does not set one (openclaw: defaults DEFAULT_CONTEXT_TOKENS). */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/**
 * Input token budget = contextLimit - reserveTokens (openclaw: compaction reserveTokensFloor, pruneHistoryForContextShare budget).
 */
export function resolveContextBudget(contextLimit: number, reserveTokens: number = RESERVE_TOKENS_DEFAULT): number {
  return Math.max(1000, Math.floor(contextLimit - reserveTokens));
}

/**
 * Trim messages to fit within contextLimit, reserving space for response and tool round-trips.
 * Strategy aligned with openclaw: context-pruning (soft/hard trim), compaction budget; we keep system (cap 50%) + most recent conversation.
 */
export function trimMessagesToFit<T extends { role: string; content: AgentMessageContent }>(
  messages: T[],
  contextLimit: number,
  reserveTokens: number = RESERVE_TOKENS_DEFAULT,
): T[] {
  const budget = resolveContextBudget(contextLimit, reserveTokens);
  const total = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  if (total <= budget) return messages;

  const systemMessages = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  // Cap combined system content to 50% of budget
  const systemBudget = Math.floor(budget * 0.5);
  let systemUsed = 0;
  const trimmedSystem: T[] = [];

  for (const msg of systemMessages) {
    const tokens = estimateMessageTokens(msg);
    if (systemUsed + tokens <= systemBudget) {
      trimmedSystem.push(msg);
      systemUsed += tokens;
      continue;
    }
    const text = contentToText(msg.content);
    const remaining = systemBudget - systemUsed - 4;
    if (remaining <= 0) break;
    const maxChars = Math.max(0, remaining * 4);
    const truncated = text.length <= maxChars ? text : text.slice(0, maxChars) + '\n\n[... context trimmed for length ...]';
    trimmedSystem.push({ ...msg, content: truncated } as T);
    systemUsed = systemBudget;
    break;
  }

  const conversationBudget = budget - systemUsed;
  const conversation: T[] = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(rest[i]);
    if (used + cost > conversationBudget && conversation.length > 0) break;
    conversation.unshift(rest[i]);
    used += cost;
  }
  return [...trimmedSystem, ...conversation];
}

/** Extract an API key or access token from an auth profile. */
export function extractToken(profile: AuthProfile): string | undefined {
  const apiKey = profile.data.apiKey;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return apiKey;
  }

  const access = profile.data.access;
  if (typeof access === 'string' && access.length > 0) {
    return access;
  }

  return undefined;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('aborted');
  }
  return typeof error === 'string' && error.includes('aborted');
}

/**
 * Context management (trimMessagesToFit, contextLimit, reserve) follows the same approach as
 * openclaw: context-window-guard, context-pruning pruner, compaction reserveTokensFloor.
 */

/** Detect context-overflow / "request too large" errors (aligned with openclaw pi-embedded-helpers/errors). */
export function isContextOverflowError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('request too large') ||
    lower.includes('request_too_large') ||
    lower.includes('request exceeds the maximum size') ||
    lower.includes('context length exceeded') ||
    lower.includes('maximum context length') ||
    lower.includes('prompt is too long') ||
    lower.includes('exceeds model context window') ||
    lower.includes('context overflow') ||
    (lower.includes('request size exceeds') && (lower.includes('context window') || lower.includes('context length'))) ||
    (lower.includes('413') && lower.includes('too large'))
  );
}

/** Detect rate-limit errors from provider API responses. */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('too many requests')) {
      return true;
    }
    // AI SDK wraps HTTP status in the error; check for 429
    if ('status' in error && (error as { status?: number }).status === 429) {
      return true;
    }
  }
  return false;
}

export function fallbackChatResponse(): string {
  return 'I cannot answer right now because no valid AI auth profile is configured. Configure a provider/API key, then try again.';
}

export function mapMessages(messages: Array<{ role: string; content: AgentMessageContent }>): Array<{ role: 'system' | 'user' | 'assistant'; content: AgentMessageContent }> {
  return messages.map((message) => ({
    role: message.role as 'system' | 'user' | 'assistant',
    content: message.content
  }));
}

export function hasImageContent(messages: Array<{ role: string; content: AgentMessageContent }>): boolean {
  return messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === 'image')
  );
}

export function getRequestBodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  }
  return '';
}

export function asTextOnly(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: AgentMessageContent }>
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }

    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : '[Image attached]'))
      .join('\n');
    return { role: message.role, content: text };
  });
}
