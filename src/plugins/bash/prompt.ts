/**
 * Bash Plugin - Prompt contribution
 */

export const BASH_PROMPT = `## Bash — \`<bash>cmd</bash>\` \`<bash timeout="60000">long cmd</bash>\` \`<bash background="true">server</bash>\`

### Git Guidelines
Git operations should only be performed when explicitly requested by the user.

**Workflow:**
- \`git status\` → \`git diff\`
- \`git add\` specific files
- \`git commit -m 'type: desc'\` (use conventional commits)
- \`git push\`

**Important:** Never commit secrets or .env files. Never skip pre-commit hooks.

 **Note:** Avoid running \`slashbot\` without arguments to prevent hanging.

Usage: \`<bash>cmd</bash>\`, \`<bash timeout="60000">long cmd</bash>\`, \`<bash background="true">server</bash>\`

Git Guidelines
Git operations should only be performed when explicitly requested by the user.

Workflow:
- git status → git diff
- git add specific files
- git commit -m 'type: desc' (use conventional commits)
- git push

Important:
Never commit secrets or .env files. Never skip pre-commit hooks.

Note:
Avoid running \`slashbot\` without arguments to prevent hanging.`;
