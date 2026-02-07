/**
 * Filesystem Plugin - Prompt contribution
 */

/* eslint-disable no-template-curly-in-string */
export const FILESYSTEM_PROMPT = [
  '## Read — `<read path="file.ts"/>` `<read path="file.ts" offset="100" limit="50"/>`',
  'Always read before editing. Line numbers in output are your reference for edits.',
  '',
  '## Edit — Unified diff. **Read first.** Use line numbers from `<read>`.',
  '`@@ -startLine,count @@` (1-based, count = context + removed lines in hunk)',
  '`-` removed, `+` added, ` ` context. Insert: count=0 + only `+` lines. Multiple hunks allowed.',
  '```',
  '<edit path="src/app.ts">',
  '@@ -5,1 @@',
  '-import { old } from "./old";',
  '+import { replacement } from "./new";',
  '@@ -15,3 @@',
  '-  const name = "old";',
  '-  const value = 42;',
  '-  return { name, value };',
  '+  const name = "new";',
  '+  const value = 100;',
  '+  return { name, value, extra: true };',
  '</edit>',
  '```',
  '',
  '## Write — `<write path="src/file.ts">content</write>`',
] as const;
