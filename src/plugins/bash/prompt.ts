/**
 * Bash Plugin - Prompt contribution
 */

export const BASH_PROMPT = `\e[32m## 🐚 Bash — \`<bash>cmd</bash>\` \`<bash timeout="60000">long cmd</bash>\` \`<bash background="true">server</bash>\`\e[0m

\e[34m### 🌳 Git Guidelines\e[0m
Git operations should only be performed when explicitly requested by the user.

\e[33m**Workflow:**\e[0m
- \`git status\` → \`git diff\`
- \`git add\` specific files
- \`git commit -m 'type: desc'\` (use conventional commits)
- \`git push\`

\e[31m**⚠️ Important:**\e[0m Never commit secrets or .env files. Never skip pre-commit hooks.

 \e[36m**💡 Note:**\e[0m Avoid running \`slashbot\` without arguments to prevent hanging.

\e[1;35m┌─────────────────────────────────────────────────────────────┐\e[0m
\e[1;35m│ \e[32m🐚 Bash Commands\e[0m \e[1;35m│\e[0m
\e[1;35m├─────────────────────────────────────────────────────────────┤\e[0m
\e[1;35m│ \e[36mUsage: \`<bash>cmd</bash>\`, \`<bash timeout="60000">long cmd</bash>\`, \`<bash background="true">server</bash>\`\e[0m \e[1;35m│\e[0m
\e[1;35m└─────────────────────────────────────────────────────────────┘\e[0m

\e[1;34m📋 🌿 Git Guidelines\e[0m
\e[90mGit operations should only be performed when explicitly requested by the user.\e[0m

\e[1;33m🔄 Workflow:\e[0m
\e[93m- \e[4mgit status\e[0m\e[93m → \e[4mgit diff\e[0m\e[93m\e[0m
\e[93m- \e[4mgit add\e[0m\e[93m specific files\e[0m
\e[93m- \e[4mgit commit -m 'type: desc'\e[0m\e[93m (use conventional commits)\e[0m
\e[93m- \e[4mgit push\e[0m\e[93m\e[0m

\e[1;31m⚠️  Important:\e[0m
\e[91mNever commit secrets or .env files. Never skip pre-commit hooks.\e[0m

\e[1;36m💡 Note:\e[0m
\e[96mAvoid running \`slashbot\` without arguments to prevent hanging.\e[0m`;
