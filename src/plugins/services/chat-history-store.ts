/**
 * @module plugins/services/chat-history-store
 *
 * Pluggable per-chat conversation history storage backends.
 * Provides a {@link ChatHistoryStore} interface and two implementations:
 *
 * - {@link FileChatHistoryStore} — Persists history to JSON files on disk (default for connectors).
 * - {@link SessionChatHistoryStore} — In-memory history with markdown session dumps for archival.
 *
 * Both support flat (user/assistant) and rich (tool call/result) message history,
 * conversation summaries, and configurable max-history limits.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentMessage, RichMessage } from '@slashbot/core/agentic/llm/index.js';

const ConnectorHistorySchema = z.record(
  z.string(),
  z.array(z.unknown()),
);

const MAX_HISTORY = 40;

function isValidRole(value: unknown): value is AgentMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant';
}

function isValidContent(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (!Array.isArray(value)) return false;

  return value.every((part) => {
    if (!part || typeof part !== 'object') return false;
    const typed = part as { type?: string; text?: unknown; image?: unknown; mimeType?: unknown };
    if (typed.type === 'text') return typeof typed.text === 'string';
    if (typed.type === 'image') {
      return typeof typed.image === 'string'
        && (typed.mimeType === undefined || typeof typed.mimeType === 'string');
    }
    return false;
  });
}

function normalizeMessage(input: unknown): AgentMessage | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { role?: unknown; content?: unknown };
  if (!isValidRole(raw.role)) return null;
  if (!isValidContent(raw.content)) return null;
  return {
    role: raw.role,
    content: raw.content as AgentMessage['content'],
  };
}

/**
 * ChatHistoryStore — pluggable per-chat conversation history backend.
 *
 * Implementations can store history in-memory, on disk, in SQLite, Redis, etc.
 */
export interface ChatHistoryStore {
  /** Retrieve conversation history for a chat. */
  get(chatId: string): Promise<AgentMessage[]>;
  /** Append messages to a chat's history. */
  append(chatId: string, messages: AgentMessage[]): Promise<void>;
  /** Clear all history for a chat. */
  clear(chatId: string): Promise<void>;
  /** Get the number of messages stored for a chat. */
  length(chatId: string): Promise<number>;
  /** Get full rich history including tool call/result messages. */
  getRich?(chatId: string): Promise<RichMessage[]>;
  /** Append full tool chain (also calls append() for backward compat). */
  appendRich?(chatId: string, messages: RichMessage[]): Promise<void>;
  /** Get conversation summary for a chat. */
  getSummary?(chatId: string): Promise<string | undefined>;
  /** Set conversation summary for a chat. */
  setSummary?(chatId: string, summary: string): Promise<void>;
}

/**
 * FileChatHistoryStore — persists history to a JSON file on disk.
 *
 * Default implementation used by Telegram and Discord connectors.
 * Stores all chat histories in a single file with atomic writes.
 */
const MAX_RICH_HISTORY = MAX_HISTORY * 3; // 120 entries for tool chains

export class FileChatHistoryStore implements ChatHistoryStore {
  private readonly histories = new Map<string, AgentMessage[]>();
  private readonly richHistories = new Map<string, RichMessage[]>();
  private readonly summaries = new Map<string, string>();
  private hydrated = false;
  private richHydrated = false;
  private summaryHydrated = false;
  private readonly filePath: string;
  private readonly richFilePath: string;
  private readonly summaryFilePath: string;
  private readonly dirPath: string;

  constructor(homeDir: string, filename = 'connector-history.json') {
    this.dirPath = homeDir;
    this.filePath = join(homeDir, filename);
    this.richFilePath = join(homeDir, 'connector-rich-history.json');
    this.summaryFilePath = join(homeDir, 'connector-summaries.json');
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const result = ConnectorHistorySchema.safeParse(JSON.parse(raw));
      if (!result.success) return;

      for (const [chatId, entry] of Object.entries(result.data)) {
        if (!Array.isArray(entry)) continue;
        const messages = entry
          .map((item) => normalizeMessage(item))
          .filter((item): item is AgentMessage => item !== null)
          .filter((message) => message.role !== 'system')
          .slice(-MAX_HISTORY);
        if (messages.length > 0) {
          this.histories.set(chatId, messages);
        }
      }
    } catch {
      // best effort
    }
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      const payload = Object.fromEntries(
        Array.from(this.histories.entries()).map(([chatId, history]) => [
          chatId,
          history.slice(-MAX_HISTORY),
        ]),
      );
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.filePath);
    } catch {
      // best effort
    }
  }

  async get(chatId: string): Promise<AgentMessage[]> {
    await this.hydrate();
    return this.histories.get(chatId) ?? [];
  }

  async append(chatId: string, messages: AgentMessage[]): Promise<void> {
    await this.hydrate();
    const history = this.histories.get(chatId) ?? [];
    history.push(...messages);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    this.histories.set(chatId, history);
    await this.persist();
  }

  async clear(chatId: string): Promise<void> {
    this.histories.delete(chatId);
    await this.persist();
  }

  async length(chatId: string): Promise<number> {
    await this.hydrate();
    return this.histories.get(chatId)?.length ?? 0;
  }

  async getRich(chatId: string): Promise<RichMessage[]> {
    await this.hydrateRich();
    return this.richHistories.get(chatId) ?? [];
  }

  async appendRich(chatId: string, messages: RichMessage[]): Promise<void> {
    await this.hydrateRich();
    const history = this.richHistories.get(chatId) ?? [];
    history.push(...messages);
    if (history.length > MAX_RICH_HISTORY) {
      history.splice(0, history.length - MAX_RICH_HISTORY);
    }
    this.richHistories.set(chatId, history);
    await this.persistRich();

    // Backward compat: also append user/assistant-only messages to flat history
    const flat = messages.filter(
      (m): m is AgentMessage => m.role === 'user' || (m.role === 'assistant' && !('toolCalls' in m)),
    );
    if (flat.length > 0) {
      await this.append(chatId, flat);
    }
  }

  private async hydrateRich(): Promise<void> {
    if (this.richHydrated) return;
    this.richHydrated = true;
    try {
      const raw = await fs.readFile(this.richFilePath, 'utf8');
      const result = ConnectorHistorySchema.safeParse(JSON.parse(raw));
      if (!result.success) return;
      for (const [chatId, entry] of Object.entries(result.data)) {
        if (!Array.isArray(entry)) continue;
        // Store as-is (RichMessage includes tool messages)
        const messages = (entry as RichMessage[]).slice(-MAX_RICH_HISTORY);
        if (messages.length > 0) {
          this.richHistories.set(chatId, messages);
        }
      }
    } catch {
      // best effort
    }
  }

  private async persistRich(): Promise<void> {
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tempPath = `${this.richFilePath}.tmp`;
      const payload = Object.fromEntries(
        Array.from(this.richHistories.entries()).map(([chatId, history]) => [
          chatId,
          history.slice(-MAX_RICH_HISTORY),
        ]),
      );
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.richFilePath);
    } catch {
      // best effort
    }
  }

  async getSummary(chatId: string): Promise<string | undefined> {
    await this.hydrateSummaries();
    return this.summaries.get(chatId);
  }

  async setSummary(chatId: string, summary: string): Promise<void> {
    await this.hydrateSummaries();
    this.summaries.set(chatId, summary);
    await this.persistSummaries();
  }

  private async hydrateSummaries(): Promise<void> {
    if (this.summaryHydrated) return;
    this.summaryHydrated = true;
    try {
      const raw = await fs.readFile(this.summaryFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [chatId, summary] of Object.entries(parsed)) {
          if (typeof summary === 'string') {
            this.summaries.set(chatId, summary);
          }
        }
      }
    } catch {
      // best effort
    }
  }

  private async persistSummaries(): Promise<void> {
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tempPath = `${this.summaryFilePath}.tmp`;
      const payload = Object.fromEntries(this.summaries.entries());
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.summaryFilePath);
    } catch {
      // best effort
    }
  }
}

// ── Markdown content helper ───────────────────────────────────────────

function contentToMarkdown(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((p) => {
      const part = p as { type?: string; text?: string };
      if (part.type === 'text') return part.text ?? '';
      return `[${part.type ?? 'unknown'}]`;
    })
    .join('\n');
}

/**
 * SessionChatHistoryStore — in-memory history with markdown session dumps.
 *
 * Context is never reloaded from disk across restarts.
 * Each chat session is dumped to `<sessionsDir>/<chatId>.md` for archival.
 */
export class SessionChatHistoryStore implements ChatHistoryStore {
  private readonly histories = new Map<string, AgentMessage[]>();
  private readonly richHistories = new Map<string, RichMessage[]>();
  private readonly summaries = new Map<string, string>();
  private readonly sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async get(chatId: string): Promise<AgentMessage[]> {
    return this.histories.get(chatId) ?? [];
  }

  async append(chatId: string, messages: AgentMessage[]): Promise<void> {
    const history = this.histories.get(chatId) ?? [];
    history.push(...messages);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    this.histories.set(chatId, history);
    await this.dumpMarkdown(chatId);
  }

  async clear(chatId: string): Promise<void> {
    this.histories.delete(chatId);
  }

  async length(chatId: string): Promise<number> {
    return this.histories.get(chatId)?.length ?? 0;
  }

  async getRich(chatId: string): Promise<RichMessage[]> {
    return this.richHistories.get(chatId) ?? [];
  }

  async appendRich(chatId: string, messages: RichMessage[]): Promise<void> {
    const history = this.richHistories.get(chatId) ?? [];
    history.push(...messages);
    if (history.length > MAX_RICH_HISTORY) {
      history.splice(0, history.length - MAX_RICH_HISTORY);
    }
    this.richHistories.set(chatId, history);

    // Backward compat: also append user/assistant-only messages to flat history
    const flat = messages.filter(
      (m): m is AgentMessage => m.role === 'user' || (m.role === 'assistant' && !('toolCalls' in m)),
    );
    if (flat.length > 0) {
      await this.append(chatId, flat);
    }
  }

  async getSummary(chatId: string): Promise<string | undefined> {
    return this.summaries.get(chatId);
  }

  async setSummary(chatId: string, summary: string): Promise<void> {
    this.summaries.set(chatId, summary);
    await this.dumpMarkdown(chatId);
  }

  private async dumpMarkdown(chatId: string): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      const safeName = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = join(this.sessionsDir, `${safeName}.md`);

      const history = this.histories.get(chatId) ?? [];
      const summary = this.summaries.get(chatId);

      const lines: string[] = [`# Session: ${chatId}`, ''];
      if (summary) {
        lines.push(`> **Summary:** ${summary}`, '');
      }
      lines.push('---', '');

      for (const msg of history) {
        const role = msg.role === 'user' ? '**User**'
          : msg.role === 'assistant' ? '**Assistant**'
          : `**${msg.role}**`;
        lines.push(`${role}:`, '', contentToMarkdown(msg.content), '', '---', '');
      }

      await fs.writeFile(filePath, lines.join('\n'), 'utf8');
    } catch {
      // best effort
    }
  }
}
