/**
 * Filesystem Plugin - Prompt contribution
 */

/* eslint-disable no-template-curly-in-string */
export const FILESYSTEM_PROMPT = [
  '## read_file — Read a file from disk',
  'ALWAYS read a file before editing it. The output shows numbered lines for reference.',
  'Parameters: `path` (required), `offset` (optional, line number), `limit` (optional, max lines).',
  '',
  '## edit_file — Edit a file using search/replace blocks',
  'You MUST use `read_file` first. Each block has a `search` field (exact content to find) and `replace` field (replacement).',
  '',
  '### Usage:',
  '- The `blocks` parameter is an array of `{search, replace}` objects.',
  '- The `search` field must match the file content EXACTLY — copy from `read_file` output verbatim.',
  '- Include enough context in search strings to uniquely identify the location (3-5 lines).',
  '- Preserve exact indentation in both search and replace.',
  '',
  '### Rules:',
  '- Copy content from `read_file` output verbatim for search fields. Preserve exact indentation.',
  '- After editing, run a formatting tool to verify syntax. Fix ALL errors before `end_task`.',
  '- NEVER generate code with syntax errors: unmatched braces, missing semicolons, broken imports, or incomplete statements.',
  '',
  '## write_file — Write complete content to a file',
  'Use for new files or when editing would require replacing most of the file. Prefer `edit_file` for existing files.',
  'Parameters: `path` (required), `content` (required, full file content).',
] as const;
