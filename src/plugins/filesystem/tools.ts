/**
 * Filesystem Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

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
      toAction: args => ({
        type: 'read',
        path: args.path as string,
        offset: args.offset as number | undefined,
        limit: args.limit as number | undefined,
      }),
    },
    {
      name: 'edit_file',
      description:
        'Edit a file by replacing oldString with newString. You MUST read the file first.',
      parameters: z.object({
        filePath: z.string().describe('File path to edit'),
        oldString: z.string().describe('The exact text to find and replace'),
        newString: z.string().describe('The replacement text (must differ from oldString)'),
        replaceAll: z.boolean().optional().describe('Replace all occurrences (default false)'),
      }),
      toAction: args => ({
        type: 'edit',
        path: args.filePath as string,
        oldString: args.oldString as string,
        newString: args.newString as string,
        replaceAll: args.replaceAll as boolean | undefined,
      }),
    },
    {
      name: 'write_file',
      description:
        'Write complete content to a file, creating it if needed. Prefer edit_file for targeted changes.',
      parameters: z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Complete file content'),
      }),
      toAction: args => ({
        type: 'write',
        path: args.path as string,
        content: args.content as string,
      }),
    },
  ];
}
