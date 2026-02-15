import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentMessage } from '../../core/agentic/llm/index.js';

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
  get(chatId: string): Promise<AgentMessage[]>;
  append(chatId: string, messages: AgentMessage[]): Promise<void>;
  clear(chatId: string): Promise<void>;
  length(chatId: string): Promise<number>;
}

/**
 * FileChatHistoryStore — persists history to a JSON file on disk.
 *
 * Default implementation used by Telegram and Discord connectors.
 * Stores all chat histories in a single file with atomic writes.
 */
export class FileChatHistoryStore implements ChatHistoryStore {
  private readonly histories = new Map<string, AgentMessage[]>();
  private hydrated = false;
  private readonly filePath: string;
  private readonly dirPath: string;

  constructor(homeDir: string, filename = 'connector-history.json') {
    this.dirPath = homeDir;
    this.filePath = join(homeDir, filename);
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
}
