/**
 * Filesystem Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

const searchReplaceBlockSchema = z.object({
  search: z.string().describe('Exact content to find in the file'),
  replace: z.string().describe('Replacement content'),
});

export function getFilesystemToolContributions(): ToolContribution[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file from disk. Returns numbered lines. Always read before editing.',
      parameters: z.object({
        path: z.string().describe('File path (relative to working directory or absolute)'),
        offset: z.number().optional().describe('Start reading from this line number (1-based)'),
        limit: z.number().optional().describe('Maximum number of lines to read'),
      }),
      toAction: (args) => ({
        type: 'read',
        path: args.path as string,
        offset: args.offset as number | undefined,
        limit: args.limit as number | undefined,
      }),
    },
    {
      name: 'edit_file',
      description: 'Edit a file using search/replace blocks. Each block finds exact content and replaces it. You MUST read the file first.',
      parameters: z.object({
        path: z.string().describe('File path to edit'),
        blocks: z.array(searchReplaceBlockSchema).describe('Search/replace blocks to apply'),
      }),
      toAction: (args) => ({
        type: 'edit',
        path: args.path as string,
        mode: 'search-replace' as const,
        blocks: args.blocks as Array<{ search: string; replace: string }>,
      }),
    },
    {
      name: 'write_file',
      description: 'Write complete content to a file, creating it if needed. Prefer edit_file for targeted changes.',
      parameters: z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Complete file content'),
      }),
      toAction: (args) => ({
        type: 'write',
        path: args.path as string,
        content: args.content as string,
      }),
    },
  ];
}
