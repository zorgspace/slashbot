/**
 * Bash Plugin - Prompt contribution
 */

export const BASH_PROMPT = `## Bash - Execute shell commands
\`\`\`
<bash>command</bash>
<bash timeout="60000">long running command</bash>
<bash background="true">server start</bash>
\`\`\`

## CRITICAL: Git Operations - USER MUST ASK
**NEVER automatically:**
- Run git status after creating/editing files
- Stage files (git add)
- Commit changes
- Push changes

Git operations are ONLY allowed when the user EXPLICITLY asks (e.g., "commit my changes", "push to git", "what's the git status").
After completing a task (file creation, code edit, etc.), just confirm the task is done. Do NOT check git status or suggest committing.

## Git Workflow (ONLY when user asks)
Use <bash>git ...</bash> for all git operations. When user EXPLICITLY asks to commit or push code:

### Step 1: Check Status and ANALYZE Changes (MANDATORY)
<bash>git status</bash>
<bash>git diff</bash>
<bash>git diff --staged</bash>
- Review ALL modified, staged, and untracked files
- ANALYZE the diff output to understand WHAT code was actually changed

### Step 2: Stage Relevant Files (tracked AND untracked)
<bash>git add file1.ts file2.ts newfile.ts</bash>

### Step 3: Commit with Accurate Message Based on Analysis
<bash>git commit -m 'type: specific description based on actual changes

Co-authored-by: Slashbot
Co-authored-by: xAI (Grok)'</bash>
- Use conventional commits: fix:, feat:, refactor:, docs:, chore:
- ALWAYS include both Co-authored-by lines

### Step 4: Push (only if tested and sane)
<bash>git push</bash>

## Git Safety Rules
- NEVER commit credentials, secrets, .env files, or sensitive data
- NEVER update git config
- NEVER skip hooks (--no-verify) unless explicitly asked

## Process Management
- /ps - List background processes
- /kill <id> - Stop a background process

## Testing Slashbot Itself
When you need to run slashbot to see its output:
- NEVER run just \`slashbot\` - it's an interactive CLI that will hang
- ALWAYS use: \`<bash>timeout 5 slashbot 2>&1 || echo "Exit code: $?"</bash>\``;
