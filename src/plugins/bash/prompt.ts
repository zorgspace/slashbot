/**
 * Bash Plugin - Prompt contribution
 */

export const BASH_PROMPT = `## Bash — \`<bash>cmd</bash>\` \`<bash timeout="60000">long cmd</bash>\` \`<bash background="true">server</bash>\`

Git: ONLY when user asks. \`git status\` + \`git diff\` → \`git add\` specific files → \`git commit -m 'type: desc'\` (conventional commits) → \`git push\`. Never commit secrets/.env, never skip hooks.
Process: /ps (list), /kill <id> (stop). Never run bare \`slashbot\` (hangs).`;
