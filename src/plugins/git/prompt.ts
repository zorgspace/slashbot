/**
 * Git Plugin - Prompt contribution
 */

export const GIT_PROMPT = [
  '## Git Worktree Management',
  '',
  'Agents must use git worktrees for isolated development environments.',
  '',
  '**Agent Workflow:**',
  '- Start each task with a clean worktree: create or switch to a dedicated branch worktree.',
  '- Perform all modifications within the worktree.',
  '- Push changes and clean up worktree upon completion.',
  '',
  '**Worktree Commands:**',
  '- `git worktree add <path> <branch>` - Create a new worktree.',
  '- `git worktree list` - List all worktrees.',
  '- `git worktree remove <path>` - Remove a worktree.',
  '- `git worktree prune` - Clean up removed worktrees.',
  '',
  '**Guidelines:**',
  '- Always work in a worktree to avoid conflicts.',
  '- Use unique branch names for each task.',
  '- Push modifications before switching or removing worktrees. Merge at the end of the work before sending <end>',
  '- Handle all edge cases: existing worktrees, branch conflicts, etc.',
].join('\n');
