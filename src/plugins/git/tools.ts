/**
 * Git Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getGitToolContributions(): ToolContribution[] {
  return [
    {
      name: 'git_status',
      description: 'Show working tree status (staged, unstaged, untracked files).',
      parameters: z.object({}),
      toAction: () => ({
        type: 'git-status',
      }),
    },
    {
      name: 'git_diff',
      description: 'Show changes between working tree and index, or between refs.',
      parameters: z.object({
        ref: z.string().optional().describe('Git ref to diff against (e.g. "HEAD~1", "main")'),
        staged: z.boolean().optional().describe('Show staged changes only'),
      }),
      toAction: args => ({
        type: 'git-diff',
        ref: args.ref as string | undefined,
        staged: args.staged as boolean | undefined,
      }),
    },
    {
      name: 'git_log',
      description: 'Show recent commit history.',
      parameters: z.object({
        count: z.number().optional().describe('Number of commits to show (default: 10)'),
      }),
      toAction: args => ({
        type: 'git-log',
        count: args.count as number | undefined,
      }),
    },
    {
      name: 'git_commit',
      description: 'Create a git commit with the specified message and optional file list.',
      parameters: z.object({
        message: z.string().describe('Commit message'),
        files: z
          .array(z.string())
          .optional()
          .describe('Specific files to stage and commit (default: all staged)'),
      }),
      toAction: args => ({
        type: 'git-commit',
        message: args.message as string,
        files: args.files as string[] | undefined,
      }),
    },
  ];
}
