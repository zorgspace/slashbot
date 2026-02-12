/**
 * Memory Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getMemoryToolContributions(): ToolContribution[] {
  return [
    {
      name: 'memory_search',
      description:
        'Search MEMORY.md and memory/*.md for matching lines. Returns path, line, and snippet.',
      parameters: z.object({
        query: z.string().describe('Search query text'),
        limit: z.number().optional().describe('Maximum number of matches (default 20, max 200)'),
      }),
      toAction: args => ({
        type: 'memory-search',
        query: args.query as string,
        limit: args.limit as number | undefined,
      }),
    },
    {
      name: 'memory_get',
      description: 'Read specific lines from a memory file.',
      parameters: z.object({
        path: z.string().describe('Relative path to memory file (MEMORY.md or memory/*.md)'),
        startLine: z.number().optional().describe('Start line (1-based, default 1)'),
        endLine: z.number().optional().describe('End line (inclusive, default startLine+49)'),
      }),
      toAction: args => ({
        type: 'memory-get',
        path: args.path as string,
        startLine: args.startLine as number | undefined,
        endLine: args.endLine as number | undefined,
      }),
    },
    {
      name: 'memory_upsert',
      description: 'Append a durable memory note into memory files (default: memory/notes.md).',
      parameters: z.object({
        text: z.string().describe('Memory content to persist'),
        tags: z.array(z.string()).optional().describe('Optional tags for later retrieval'),
        file: z
          .string()
          .optional()
          .describe('Optional target memory file (MEMORY.md or memory/*.md)'),
      }),
      toAction: args => ({
        type: 'memory-upsert',
        text: args.text as string,
        tags: args.tags as string[] | undefined,
        file: args.file as string | undefined,
      }),
    },
    {
      name: 'memory_stats',
      description: 'Return memory index/cache statistics for diagnostics.',
      parameters: z.object({}),
      toAction: () => ({
        type: 'memory-stats',
      }),
    },
  ];
}
