/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = `## Explore — \`<explore query="auth"/>\` \`<explore query="handleError" path="src" depth="deep"/>\`
Depths: quick|medium(default)|deep|comprehensive. Use before manual grep for broad searches.

## Grep — \`<grep pattern="export" path="src"/>\` \`<grep pattern="TODO" path="src" glob="*.ts" i="true" C="3"/>\`
**path REQUIRED.** Options: glob, i, n, B/A/C, limit, multiline, output (files_with_matches)

## Glob — \`<glob pattern="**/*.ts"/>\` \`<glob pattern="*.json" path="src"/>\`
## LS — \`<ls path="src"/>\` \`<ls path="." ignore="node_modules,dist"/>\`
## Format — \`<format/>\` \`<format path="src/file.ts"/>\` Only after successful edits.`;
