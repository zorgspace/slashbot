/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = [
  '## Search & Navigation Tools',
  '',
  '## grep — Search file contents with regex',
  'Parameters: `pattern` (required), `path` (optional), `glob` (file filter), `case_insensitive`, `context` (lines around match), `output_mode` (content/files_with_matches/count).',
  '',
  '## glob — Find files by pattern',
  'Parameters: `pattern` (required, e.g. "**/*.ts"), `path` (optional, search directory).',
  '',
  '## ls — List directory contents',
  'Parameters: `path` (required), `ignore` (optional, array of patterns to skip).',
  '',
  '**Workflow:** `grep` or `glob` to find → `read_file` → `edit_file` → `end_task`.',
  '**Tips:** Use grep/read_file to verify that APIs, imports, and types exist before using them.',
].join('\n');
