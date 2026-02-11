/**
 * Code Editor Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getCodeEditorToolContributions(): ToolContribution[] {
  return [
    {
      name: 'glob',
      description: 'Find files matching a glob pattern. Returns matching file paths.',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern (e.g. "src/**/*.ts", "*.json")'),
        path: z
          .string()
          .optional()
          .describe('Directory to search in (defaults to working directory)'),
      }),
      toAction: args => ({
        type: 'glob',
        pattern: args.pattern as string,
        path: args.path as string | undefined,
      }),
    },
    {
      name: 'grep',
      description:
        'Search file contents using regex patterns. Returns matching lines or file paths.',
      parameters: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().optional().describe('File or directory to search in'),
        glob: z.string().optional().describe('Glob filter for files (e.g. "*.ts")'),
        output_mode: z
          .enum(['content', 'files_with_matches', 'count'])
          .optional()
          .describe('Output format (default: files_with_matches)'),
        context: z.number().optional().describe('Lines of context around matches'),
        case_insensitive: z.boolean().optional().describe('Case insensitive search'),
        head_limit: z.number().optional().describe('Limit output to first N results'),
        multiline: z.boolean().optional().describe('Enable multiline matching'),
      }),
      toAction: args => ({
        type: 'grep',
        pattern: args.pattern as string,
        path: args.path as string | undefined,
        glob: args.glob as string | undefined,
        outputMode: args.output_mode as string | undefined,
        context: args.context as number | undefined,
        caseInsensitive: args.case_insensitive as boolean | undefined,
        headLimit: args.head_limit as number | undefined,
        multiline: args.multiline as boolean | undefined,
      }),
    },
    {
      name: 'ls',
      description: 'List directory contents with file sizes and types.',
      parameters: z.object({
        path: z.string().describe('Directory path to list'),
        ignore: z.array(z.string()).optional().describe('Patterns to ignore'),
      }),
      toAction: args => ({
        type: 'ls',
        path: args.path as string,
        ignore: args.ignore as string[] | undefined,
      }),
    },
  ];
}
