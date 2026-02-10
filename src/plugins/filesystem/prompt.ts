/**
 * Filesystem Plugin - Prompt contribution
 */

/* eslint-disable no-template-curly-in-string */
export const FILESYSTEM_PROMPT = [
  '## read_file — Read a file from disk',
  'ALWAYS read a file before editing it. The output shows numbered lines for reference.',
  'Parameters: `path` (required), `offset` (optional, line number), `limit` (optional, max lines).',
  '',
  '## edit_file — Edit a file by replacing oldString with newString',
  'You MUST use `read_file` first. Each call replaces one occurrence of `oldString` with `newString`.',
  '',
  '### Parameters:',
  '- `filePath`: Path to the file to edit.',
  '- `oldString`: The exact text to find in the file (must match file content exactly).',
  '- `newString`: The replacement text (must be different from oldString).',
  '- `replaceAll` (optional): If true, replace all occurrences. Default is false (single match).',
  '',
  '### Rules:',
  '- Copy content from `read_file` output verbatim for `oldString`. Preserve exact indentation.',
  '- If the edit fails with "multiple matches", include more surrounding context in `oldString` to uniquely identify the location.',
  '- For multiple edits to the same file, make separate `edit_file` calls for each change.',
  '- After editing, run a formatting tool to verify syntax. MANDATORY Fix ALL errors before `end_task`.',
  '- NEVER generate code with syntax errors: unmatched braces, missing semicolons, broken imports, or incomplete statements.',
  '',
  '## write_file — Write complete content to a file',
  'Use for new files or when editing would require replacing most of the file. Prefer `edit_file` for existing files.',
  'Parameters: `path` (required), `content` (required, full file content).',
] as const;
