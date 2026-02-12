import type { ActionResult } from '../actions/types';

const MAX_GENERIC_RESULT_CHARS = 1600;
const MAX_READ_RESULT_CHARS = 14000;
const MAX_EXPLORE_RESULT_CHARS = 3000;
const MAX_EXPLORE_PREVIEW_LINES = 12;
const MAX_CONTINUATION_RESULTS = 8;

const EXPLORE_TOOL_NAMES = new Set(['glob', 'grep', 'ls', 'list', 'explore']);
const READ_TOOL_NAMES = new Set(['read', 'read_file']);

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const trimmed = text.slice(0, maxChars);
  return `${trimmed}\n... [truncated ${text.length - maxChars} chars]`;
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function summarizeExploreResult(result: string): string {
  const lines = result
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return 'No matches';
  }
  const preview = lines.slice(0, MAX_EXPLORE_PREVIEW_LINES);
  const hidden = lines.length - preview.length;
  const body = preview.join('\n');
  const suffix = hidden > 0 ? `\n... [${hidden} more lines]` : '';
  return truncate(`${body}${suffix}`, MAX_EXPLORE_RESULT_CHARS);
}

function deriveToolNameFromAction(action?: string): string {
  if (!action) return '';
  const head = action.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_');
  if (head.startsWith('read')) return 'read_file';
  if (head.startsWith('edit')) return 'edit_file';
  if (head.startsWith('write') || head.startsWith('create')) return 'write_file';
  if (head.startsWith('glob')) return 'glob';
  if (head.startsWith('grep')) return 'grep';
  if (head === 'ls' || head.startsWith('ls')) return 'ls';
  if (head.startsWith('bash')) return 'bash';
  return head;
}

function summarizeByToolName(toolName: string, result: string): string {
  const normalized = normalizeToolName(toolName);
  if (READ_TOOL_NAMES.has(normalized)) {
    return truncate(result, MAX_READ_RESULT_CHARS);
  }
  if (EXPLORE_TOOL_NAMES.has(normalized)) {
    return summarizeExploreResult(result);
  }
  return truncate(result, MAX_GENERIC_RESULT_CHARS);
}

function selectContinuationResults(
  results: Array<{ result: ActionResult; index: number }>,
): Array<{ result: ActionResult; index: number }> {
  if (results.length <= MAX_CONTINUATION_RESULTS) {
    return results;
  }

  const selected = new Set<number>();
  const failures = results.filter(item => !item.result.success);
  for (let i = failures.length - 1; i >= 0; i -= 1) {
    if (selected.size >= MAX_CONTINUATION_RESULTS) break;
    selected.add(failures[i].index);
  }

  if (selected.size < MAX_CONTINUATION_RESULTS) {
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (selected.size >= MAX_CONTINUATION_RESULTS) break;
      selected.add(results[i].index);
    }
  }

  return results.filter(item => selected.has(item.index));
}

export function summarizeToolResultForHistory(toolName: string, rawResult: unknown): string {
  const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult ?? '');
  return summarizeByToolName(toolName, result);
}

export function buildContinuationActionOutput(results: ActionResult[]): string {
  const indexed = results.map((result, index) => ({ result, index }));
  const selected = selectContinuationResults(indexed).sort((a, b) => a.index - b.index);

  const blocks = selected.map(({ result }) => {
    const action = String(result.action ?? 'Action');
    const status = result.success ? '✓' : '✗';
    const errorNote = result.error ? ` (${truncate(String(result.error), 220)})` : '';
    const toolName = deriveToolNameFromAction(result.action);
    const summary = summarizeByToolName(toolName, String(result.result ?? ''));
    return `[${status}] ${action}${errorNote}\n${summary}`;
  });

  const omitted = Math.max(0, results.length - selected.length);
  if (omitted > 0) {
    blocks.push(`[i] ${omitted} older action result(s) omitted for context hygiene.`);
  }

  return `<action-output>\n${blocks.join('\n\n')}\n</action-output>`;
}
