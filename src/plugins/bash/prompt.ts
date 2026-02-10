/**
 * Bash Plugin - Prompt contribution
 */

export const BASH_PROMPT = [
  '## bash — Execute shell commands',
  'Parameters: `command` (required), `timeout` (optional, ms), `description` (optional), `background` (optional, boolean).',
  '',
  '### Git Guidelines',
  'Git operations should only be performed when explicitly requested by the user.',
  '',
  '**Workflow:**',
  '- `git status` then `git diff`',
  '- `git add` specific files',
  '- `git commit -m "type: desc"` (use conventional commits)',
  '- `git push`',
  '',
  '**Important:** Never commit secrets or .env files. Never skip pre-commit hooks.',
  '**Note:** Avoid running `slashbot` without arguments to prevent hanging.',
].join('\n');
