/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = `## Explore - \`<explore query="auth"/>\` \`<explore query="handleError" path="src" depth="deep"/>\`
Depths: quick|medium(default)|deep|comprehensive. Try incrementally deeper search sequences. Use before manual grep for broad searches.

## Grep - \`<grep pattern="export" path="src"/>\` \`<grep pattern="TODO" path="src" glob="*.ts" i="true" C="3"/>\`
**path REQUIRED.** Options: glob, i, n, B/A/C, limit, multiline, output (files_with_matches)

## Glob - \`<glob pattern="**/*.ts"/>\` \`<glob pattern="*.json" path="src"/>\`
## LS - \`<ls path="src"/>\` \`<ls path="." ignore="node_modules,dist"/>\`
## Read - \`<read path="file.ts"/>\` \`<read path="file.ts" offset="100" limit="50"/>\`
Always read before editing. Output looks like:
\`\`\`
[typescript] src/app.ts
1│import { foo } from "./foo";
2│export class App {
3│  run() { foo(); }
\`\`\`
Each line is \`number│content\` — the \`│\` separates the line number from the code, preserving exact indentation. Use these numbers as \`startLine\` in \`<edit>\` hunks.

## Edit - Unified diff format. **Read the file first.** Each hunk header \`@@ -startLine,count @@\` references lines from \`<read>\`:
- **startLine**: 1-based line where the hunk begins.
- **count**: number of existing lines covered (context + removed). Use count=0 for pure insertions.
- Prefix every line: \` \` (space) = context (must match file), \`-\` = remove, \`+\` = add.
- Multiple hunks per \`<edit>\` are fine; they apply top-down.
`;
