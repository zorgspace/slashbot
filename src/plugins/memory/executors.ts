/**
 * Memory action executors
 */

import type { ActionHandlers, ActionResult } from '../../core/actions/types';
import { display, formatToolAction } from '../../core/ui';

type MemorySearchAction = { type: 'memory-search'; query: string; limit?: number };
type MemoryGetAction = {
  type: 'memory-get';
  path: string;
  startLine?: number;
  endLine?: number;
};
type MemoryUpsertAction = {
  type: 'memory-upsert';
  text: string;
  tags?: string[];
  file?: string;
};
type MemoryStatsAction = {
  type: 'memory-stats';
};

function normalizeWorkspaceRelative(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isAllowedMemoryPath(p: string): boolean {
  const normalized = normalizeWorkspaceRelative(p).toLowerCase();
  return normalized === 'memory.md' || normalized.startsWith('memory/');
}

export async function executeMemorySearch(
  action: MemorySearchAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMemorySearch) return null;
  const limit = Math.max(1, Math.min(200, Number(action.limit || 20)));
  const hits = await handlers.onMemorySearch(action.query, limit);
  const rows = Array.isArray(hits) ? hits : [];
  display.appendAssistantMessage(
    formatToolAction('MemorySearch', action.query, {
      success: true,
      summary: `${rows.length} match${rows.length === 1 ? '' : 'es'}`,
    }),
  );
  if (rows.length > 0) {
    const preview = rows.slice(0, 5);
    const extra = rows.length > preview.length ? `\n- ... +${rows.length - preview.length} more match(es)` : '';
    const snippet = preview
      .map(row => {
        const text = String(row.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        return `- ${row.path}:${row.line}: ${text}`;
      })
      .join('\n');
    display.appendAssistantMarkdown(
      `Memory hits (${rows.length} total):\n${snippet}${extra}`,
    );
  }
  return {
    action: `MemorySearch: ${action.query}`,
    success: true,
    result:
      rows.length === 0
        ? 'No memory matches'
        : rows.map((r: any) => `${r.path}:${r.line}: ${String(r.text).slice(0, 500)}`).join('\n'),
  };
}

export async function executeMemoryGet(
  action: MemoryGetAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMemoryGet) return null;
  if (!isAllowedMemoryPath(action.path)) {
    return {
      action: `MemoryGet: ${action.path}`,
      success: false,
      result: 'Blocked',
      error: 'memory_get only allows MEMORY.md and memory/*.md',
    };
  }
  const normalizedPath = normalizeWorkspaceRelative(action.path);
  const content = await handlers.onMemoryGet(normalizedPath, action.startLine, action.endLine);
  const success = !!content;
  display.appendAssistantMessage(
    formatToolAction('MemoryGet', normalizedPath, {
      success,
      summary: success ? `${String(content).split('\n').length} lines` : 'not found',
    }),
  );
  return {
    action: `MemoryGet: ${normalizedPath}`,
    success,
    result: success ? String(content) : 'Not found',
    error: success ? undefined : 'Memory file not found or unreadable',
  };
}

export async function executeMemoryUpsert(
  action: MemoryUpsertAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMemoryUpsert) return null;
  const text = String(action.text || '').trim();
  if (!text) {
    return {
      action: 'MemoryUpsert',
      success: false,
      result: 'Blocked',
      error: 'text is required',
    };
  }
  const result = await handlers.onMemoryUpsert({
    text,
    tags: Array.isArray(action.tags) ? action.tags : undefined,
    file: action.file,
  });
  display.appendAssistantMessage(
    formatToolAction('MemoryUpsert', action.file || 'memory/notes.md', {
      success: true,
      summary: `${result?.path || 'memory/notes.md'}:${result?.line || '?'}`,
    }),
  );
  return {
    action: 'MemoryUpsert',
    success: true,
    result: `${result?.path || 'memory/notes.md'}:${result?.line || '?'}`,
  };
}

export async function executeMemoryStats(
  _action: MemoryStatsAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMemoryStats) return null;
  const stats = await handlers.onMemoryStats();
  const files = Number(stats?.files || 0);
  const chunks = Number(stats?.chunks || 0);
  display.appendAssistantMessage(
    formatToolAction('MemoryStats', 'index', {
      success: true,
      summary: `${files} files, ${chunks} chunks`,
    }),
  );
  return {
    action: 'MemoryStats',
    success: true,
    result: [
      `files=${files}`,
      `chunks=${chunks}`,
      `cacheHits=${Number(stats?.cacheHits || 0)}`,
      `cacheMisses=${Number(stats?.cacheMisses || 0)}`,
      `indexedAt=${stats?.indexedAt ? new Date(stats.indexedAt).toISOString() : 'never'}`,
    ].join('\n'),
  };
}
