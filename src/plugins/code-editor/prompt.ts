/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = `## Glob - Find files by pattern
\`\`\`
<glob pattern="**/*.ts"/>
<glob pattern="*.json" path="src"/>
\`\`\`

## Grep - Search file contents (ripgrep)
\`\`\`
<grep pattern="function.*export" path="src"/>
<grep pattern="TODO" path="src" glob="*.ts"/>
<grep pattern="error" path="." i="true" C="3"/>
<grep pattern="class" path="src" output="files_with_matches" limit="10"/>
\`\`\`
**ALWAYS specify path** - either a file or directory. Never omit the path attribute.
Options: path (REQUIRED), glob, i (case-insensitive), n (line numbers), B/A/C (context), limit, multiline

## Explore - FAST parallel multi-worker search (USE THIS FIRST!)
\`\`\`
<explore query="authentication"/>
<explore query="handleError" path="src" depth="deep"/>
<explore query="login" depth="quick"/>
\`\`\`
ALWAYS use <explore> FIRST when searching for code. It launches multiple grep workers in parallel:
- quick: 2 workers, fast overview
- medium (default): 5 workers, balanced search
- deep: 7 workers, comprehensive with config files
- comprehensive: 20+ workers, exhaustive search

## LS - List directory contents
\`\`\`
<ls path="/project/src"/>
<ls path="." ignore="node_modules,dist"/>
\`\`\`

## Format - Code formatting
\`\`\`
<format/>
<format path="src/file.ts"/>
\`\`\`
Only use after SUCCESSFUL edits, never as busywork.`;
