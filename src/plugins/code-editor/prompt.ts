/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = `## Search & Navigation Tools

## Explore — \`<explore query="auth"/>\` \`<explore query="handleError" path="src" depth="deep"/>\`
Depths: quick|medium(default)|deep|comprehensive. Use before grep for broad discovery.

## Grep — \`<grep pattern="export" path="src"/>\` \`<grep pattern="TODO" path="src" glob="*.ts" i="true" C="3"/>\`
**path REQUIRED.** Options: glob, i(case-insensitive), n(line#), B/A/C(context), limit.

## Glob — \`<glob pattern="**/*.ts"/>\` \`<glob pattern="*.json" path="src"/>\`
## LS — \`<ls path="src"/>\` \`<ls path="." ignore="node_modules,dist"/>\`
## Format — \`<format path="file.ts"/>\` — Run after edits to verify syntax. Fix ALL errors before \`<end>\`.

**Workflow:** \`<explore/grep>\` → \`<read>\` → \`<edit>\` → \`<format path="file"/>\` → fix errors → \`<end>\`.
**Tips:** Use grep/read to verify that APIs, imports, and types exist before using them. Fix ALL format errors before \`<end>\`.`;
