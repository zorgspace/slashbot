/**
 * Code Editor Plugin - Prompt contribution
 */

export const CODE_EDITOR_PROMPT = [
  '## Search & Navigation Tools',
  '',
  '## grep — Search file contents with regex',
  'Parameters: `pattern` (required), `path` (optional), `glob` (file filter), `output_mode` (content/files_with_matches/count), `context` (lines around match), `context_before` (lines before), `context_after` (lines after), `case_insensitive`, `line_numbers`, `head_limit`, `multiline`.',
  '',
  '## glob — Find files by pattern',
  'Parameters: `pattern` (required, e.g. "**/*.ts"), `path` (optional, search directory; accepts relative, absolute, or `~/...`).',
  '',
  '## ls — List directory contents',
  'Parameters: `path` (required), `ignore` (optional, array of patterns to skip).',
  '',
  '**Workflow:** If file path is likely known, `read_file` first. Use `glob`/`ls` only for focused discovery and `grep` for targeted content search, then `edit_file`/`write_file`, then `end_task`.',
  '**Tips:** Prefer narrow paths and precise patterns (`src/**/*.ts`, not `**/*`). After discovery, read the exact file and avoid repeating broad probes. Use numbered read output for edits to avoid guessing.',
].join('\n');
