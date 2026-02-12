/**
 * Git Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getGitToolContributions(): ToolContribution[] {
  return [
    {
      name: 'git_worktree_list',
      description: 'List all git worktrees in the repository.',
      parameters: z.object({}),
      toAction: () => ({
        type: 'bash',
        command: 'git worktree list',
      }),
    },
    {
      name: 'git_worktree_add',
      description: 'Add a new git worktree for a branch.',
      parameters: z.object({
        path: z.string().describe('Path for the new worktree'),
        branch: z.string().describe('Branch name for the worktree'),
      }),
      toAction: args => ({
        type: 'bash',
        command: `git worktree add "${args.path}" "${args.branch}"`,
      }),
    },
    {
      name: 'git_worktree_remove',
      description: 'Remove a git worktree.',
      parameters: z.object({
        path: z.string().describe('Path of the worktree to remove'),
      }),
      toAction: args => ({
        type: 'bash',
        command: `git worktree remove "${args.path}"`,
      }),
    },
    {
      name: 'git_worktree_prune',
      description: 'Prune removed git worktrees.',
      parameters: z.object({}),
      toAction: () => ({
        type: 'bash',
        command: 'git worktree prune',
      }),
    },
  ];
}