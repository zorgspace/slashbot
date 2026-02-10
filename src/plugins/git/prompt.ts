export const GIT_PROMPT = [
  'Git tools for version control:',
  '- `git_status` — Show working tree status',
  '- `git_diff` — Show diff (optional: `ref`, `staged`)',
  '- `git_log` — Show commit history (optional: `count`)',
  '- `git_commit` — Create a commit (required: `message`, optional: `files`)',
  '',
  'Git workflow guidelines:',
  '- Check `git_status` before starting work to understand the current state.',
  '- Make atomic commits with meaningful messages.',
  '- Never force-push or rewrite history without explicit user consent.',
  '- Prefer staging specific files over `git add -A` when possible.',
].join('\n');
