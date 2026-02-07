/**
 * File Action Handlers - Read, Edit, Write, Create operations
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { ReadAction, EditAction, WriteAction, CreateAction } from './types';
import { display } from '../../core/ui';

export async function executeRead(
  action: ReadAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onRead) return null;

  // Display action in Claude Code style
  const rangeInfo =
    action.offset || action.limit
      ? ` (offset: ${action.offset || 0}, limit: ${action.limit || 'all'})`
      : '';
  display.read(action.path + rangeInfo);

  const fileContent = await handlers.onRead(action.path, {
    offset: action.offset,
    limit: action.limit,
  });

  if (fileContent) {
    const lines = fileContent.split('\n');
    const lineCount = lines.length;
    display.readResult(lineCount);
    // Detect language from file extension so the LLM knows the syntax
    const ext = action.path.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript (tsx)', js: 'javascript', jsx: 'javascript (jsx)',
      py: 'python', rs: 'rust', go: 'go', rb: 'ruby', java: 'java', kt: 'kotlin',
      c: 'c', cpp: 'c++', h: 'c header', hpp: 'c++ header', cs: 'c#',
      swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'zsh', fish: 'fish',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
      html: 'html', css: 'css', scss: 'scss', less: 'less', svelte: 'svelte', vue: 'vue',
      sql: 'sql', md: 'markdown', txt: 'plain text', dockerfile: 'dockerfile',
      lua: 'lua', zig: 'zig', nim: 'nim', ex: 'elixir', exs: 'elixir',
      php: 'php', r: 'r', pl: 'perl', dart: 'dart', sol: 'solidity',
    };
    const lang = langMap[ext] || ext;
    // Send full content to LLM with language header and line numbers
    const startLine = (action.offset || 0) + 1;
    const endLine = startLine + lines.length - 1;
    // Include range info in header when partial read, so LLM knows the visible window
    const rangeNote = action.offset || action.limit ? ` (lines ${startLine}-${endLine})` : '';
    const header = lang ? `[${lang}] ${action.path}${rangeNote}` : `${action.path}${rangeNote}`;
    const pad = String(endLine).length;
    const numberedContent = lines
      .map((line, i) => `${String(startLine + i).padStart(pad, ' ')}│${line}`)
      .join('\n');
    return { action: `Read: ${action.path}`, success: true, result: `${header}\n${numberedContent}` };
  } else {
    display.error('File not found');
    return {
      action: `Read: ${action.path}`,
      success: false,
      result: 'File not found',
      error: 'File not found',
    };
  }
}

export async function executeEdit(
  action: EditAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onEdit) return null;

  display.update(action.path);

  const result = await handlers.onEdit(action.path, action.mode, action.content, action.blocks);

  if (result.status === 'applied') {
    display.updateResult(true, 0, 0);
  } else if (result.status === 'already_applied') {
    display.success('Already applied (skipped)');
  } else if (result.status === 'conflict') {
    display.updateResult(true, 0, 0);
    const conflictCount = result.conflicts?.length || 0;
    display.warning(`Applied with ${conflictCount} conflict(s) — LLM version used for conflicts`);
  } else if (result.status === 'not_found') {
    display.updateResult(false, 0, 0);
    display.error(
      result.message?.includes('File not found')
        ? `File not found: ${action.path}. Use <read> to check if file exists, or <write> to make a new file.`
        : `${result.message}`,
    );
  } else if (result.status === 'no_match') {
    display.updateResult(false, 0, 0);
    display.error(`Search block not found in ${action.path} — re-read and retry.`);
  } else {
    display.updateResult(false, 0, 0);
  }

  let errorMsg = result.message;
  if (!result.success) {
    if (result.status === 'not_found') {
      errorMsg = result.message?.includes('File not found')
        ? `${result.message} - Use <read> to verify path or <write> to make new file`
        : `${result.message} - Use <read path="${action.path}"/> first to see actual content`;
    } else if (result.status === 'no_match') {
      errorMsg = `${result.message}`;
    }
  }

  return {
    action: `Edit: ${action.path}`,
    success: result.success,
    result:
      result.status === 'already_applied'
        ? 'Skipped (already applied)'
        : result.success
          ? 'OK'
          : (result.message || 'Failed'),
    error: result.success ? undefined : errorMsg,
  };
}

export async function executeWrite(
  action: WriteAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const handler = handlers.onWrite || handlers.onCreate;
  if (!handler) return null;

  display.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  display.writeResult(success, lineCount);

  return {
    action: `Write: ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to write file',
  };
}

export async function executeCreate(
  action: CreateAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const handler = handlers.onCreate || handlers.onWrite;
  if (!handler) return null;

  display.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  display.writeResult(success, lineCount);

  return {
    action: `Write: ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to create file',
  };
}
