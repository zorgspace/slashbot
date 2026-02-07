/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = `## Search & Navigation Tools

## Explore - &lt;explore query="auth"/&gt; &lt;explore query="handleError" path="src" depth="deep"/&gt;
Depths: quick|medium(default)|deep|comprehensive. Use before grep for broad search.

## Grep - &lt;grep pattern="export" path="src"/&gt; &lt;grep pattern="TODO" path="src" glob="*.ts" i="true" C="3"/&gt;
**path REQUIRED.** Options: glob, i(case-insensitive), n(line#), B/A/C(context), limit.

## Glob - &lt;glob pattern="**/*.ts"/&gt; &lt;glob pattern="*.json" path="src"/&gt;
## LS - &lt;ls path="src"/&gt; &lt;ls path="." ignore="node_modules,dist"/&gt;

## Read - &lt;read path="file.ts"/&gt; &lt;read path="file.ts" offset="100" limit="50"/&gt;
**ALWAYS read before editing.** Output: [lang] path\n1│code line\n... Use exact number│ for &lt;edit&gt; startLine.

## Edit - Unified diff format. **READ FIRST. NEVER assume lines.**
Hunk header: @@ -startLine,count @@ (1-based from &lt;read&gt;)
- count: existing lines (context+removed); 0=pure insert.
- Prefix: ' ' (context, EXACT match), - (remove), + (add).
- 1-3 context lines for safety. Multiple hunks top-down.

**Example (for example, don\'t use it as is):**
\`\`\`
&lt;edit path="src/app.ts"&gt;
@@ -1,0 @@
+import { foo } from "./foo";
@@ -5,1 @@
- oldImport();
+ newImport();
&lt;/edit&gt;
\`\`\`

**Workflow:** &lt;explore/grep&gt; → &lt;read&gt; → &lt;edit&gt; → &lt;format path="file"/&gt; verify → repeat if error.
**Tips:** Grep/read verify APIs/imports exist. Fix ALL errors before &lt;end&gt;. No duplicate reads.`;
