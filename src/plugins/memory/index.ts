import type { JsonValue, SlashbotPlugin } from '@slashbot/plugin-sdk';
import { MemoryStore } from '../services/memory-store.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { asObject, asString } from '../utils.js';

const PLUGIN_ID = 'slashbot.memory';

/**
 * Memory plugin — persistent markdown-based memory across sessions.
 *
 * Tools:
 *  - `memory.search` — Full-text search across memory files.
 *  - `memory.get`    — Read a specific memory file (with optional line range).
 *  - `memory.upsert` — Store a fact, decision, or preference for future sessions.
 *  - `memory.stats`  — Get memory store statistics (file count, total size).
 *
 * Services:
 *  - `memory.store` — MemoryStore instance for programmatic access.
 *
 * Context provider:
 *  - `memory.context` — Injects MEMORY.md content into the system prompt.
 */
export function createMemoryPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Memory',
      version: '0.1.0',
      main: 'bundled',
      description: 'Persistent markdown-based memory with search, read, and write',
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const store = new MemoryStore(workspaceRoot);

      context.registerService({
        id: 'memory.store',
        pluginId: PLUGIN_ID,
        description: 'Markdown-based memory store',
        implementation: store,
      });

      context.registerTool({
        id: 'memory.search',
        title: 'Search',
        pluginId: PLUGIN_ID,
        description: 'Search memory for past decisions, project context, or user preferences. Use when user references something from a past session. Args: { query: string, limit?: number }',
        parameters: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().optional().describe('Max results (default 10)'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const query = asString(input.query, 'query');
            const limit = typeof input.limit === 'number' ? input.limit : 10;
            const hits = await store.search(query, limit);
            return { ok: true, output: hits as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_SEARCH_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.get',
        title: 'Recall',
        pluginId: PLUGIN_ID,
        description: 'Read a memory file. Args: { path: string, startLine?: number, endLine?: number }',
        parameters: z.object({
          path: z.string().describe('Memory file path'),
          startLine: z.number().optional().describe('Start line number'),
          endLine: z.number().optional().describe('End line number'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const path = asString(input.path, 'path');
            const startLine = typeof input.startLine === 'number' ? input.startLine : undefined;
            const endLine = typeof input.endLine === 'number' ? input.endLine : undefined;
            const content = await store.get(path, startLine, endLine);
            return { ok: true, output: content };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_GET_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.upsert',
        title: 'Remember',
        pluginId: PLUGIN_ID,
        description: 'Store a fact, decision, or preference for future sessions. Use when user says "remember X" or after discovering important project info. Args: { text: string, tags?: string[], file?: string }',
        parameters: z.object({
          text: z.string().describe('Content to remember'),
          tags: z.array(z.string()).optional().describe('Tags for categorization'),
          file: z.string().optional().describe('Target memory file'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const text = asString(input.text, 'text');
            const tags = Array.isArray(input.tags) ? (input.tags as string[]) : undefined;
            const file = typeof input.file === 'string' ? input.file : undefined;
            const result = await store.upsert({ text, tags, file });
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_UPSERT_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.stats',
        title: 'Stats',
        pluginId: PLUGIN_ID,
        description: 'Get memory store statistics. Args: {}',
        parameters: z.object({}),
        execute: async () => {
          try {
            const stats = await store.stats();
            return { ok: true, output: stats as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_STATS_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.note',
        title: 'Note',
        pluginId: PLUGIN_ID,
        description: 'Add a quick timestamped daily note. Appends to today\'s daily notes file (YYYYMM/YYYYMMDD.md). Args: { text: string }',
        parameters: z.object({
          text: z.string().describe('Note content'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const text = asString(input.text, 'text');
            const result = await store.appendToday(text);
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_NOTE_ERROR', message: String(err) } };
          }
        },
      });

      context.contributeContextProvider({
        id: 'memory.context',
        pluginId: PLUGIN_ID,
        priority: 20,
        provide: async () => {
          const parts: string[] = [];
          try {
            const memPath = join(workspaceRoot, '.slashbot', 'MEMORY.md');
            const content = await fs.readFile(memPath, 'utf8');
            if (content.trim().length > 0) {
              parts.push(`## Memory (MEMORY.md)\n${content.trim()}`);
            }
          } catch {
            // No MEMORY.md
          }
          try {
            const recentNotes = await store.getRecentNotes(3);
            if (recentNotes.trim().length > 0) {
              parts.push(`## Recent Daily Notes\n${recentNotes.trim()}`);
            }
          } catch {
            // No daily notes
          }
          return parts.join('\n\n');
        },
      });
    },
  };
}

export { createMemoryPlugin as createPlugin };
