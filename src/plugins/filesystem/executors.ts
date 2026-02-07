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
    const header = lang ? `[${lang}] ${action.path}` : action.path;
    // Send full content to LLM with language header and line numbers
    const startLine = (action.offset || 0) + 1;
    const maxLineNum = startLine + lines.length - 1;
    const pad = String(maxLineNum).length;
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

  const result = await handlers.onEdit(action.path, action.hunks);

  if (result.status === 'applied') {
    // Show diff for each hunk
    for (const hunk of action.hunks) {
      const removed = hunk.diffLines.filter(l => l.type === 'remove').map(l => l.content);
      const added = hunk.diffLines.filter(l => l.type === 'add').map(l => l.content);
      display.updateResult(true, removed.length, added.length);
      if (removed.length > 0 || added.length > 0) {
        display.diff(removed, added, action.path, hunk.startLine);
      }
    }
  } else if (result.status === 'already_applied') {
    display.success('Already applied (skipped)');
  } else if (result.status === 'not_found') {
    display.updateResult(false, 0, 0);
    if (result.message?.includes('File not found')) {
      display.error(
        `File not found: ${action.path}. Use <read> to check if file exists, or <write> to make a new file.`,
      );
    } else {
      display.error(`${result.message}`);
    }
  } else {
    display.updateResult(false, 0, 0);
  }

  let errorMsg = result.message;
  if (!result.success && result.status === 'not_found') {
    errorMsg = result.message?.includes('File not found')
      ? `${result.message} - Use <read> to verify path or <write> to make new file`
      : `${result.message} - Use <read path="${action.path}"/> first to see actual content`;
  }

  return {
    action: `Edit: ${action.path}`,
    success: result.success,
    result:
      result.status === 'already_applied'
        ? 'Skipped (already applied)'
        : result.success
          ? 'OK'
          : 'Failed',
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
