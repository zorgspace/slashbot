/**
 * File Action Handlers - Read, Edit, Write, Create operations
 */

import type {
  ActionResult,
  ActionHandlers,
  ReadAction,
  EditAction,
  MultiEditAction,
  WriteAction,
  CreateAction,
} from '../types';
import { step } from '../../ui/colors';

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
  step.read(action.path + rangeInfo);

  const fileContent = await handlers.onRead(action.path, {
    offset: action.offset,
    limit: action.limit,
  });

  if (fileContent) {
    const lineCount = fileContent.split('\n').length;
    step.readResult(lineCount);
    // Send full content to LLM (no truncation)
    return { action: `Read: ${action.path}`, success: true, result: fileContent };
  } else {
    step.error('File not found');
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

  step.update(action.path);

  const result = await handlers.onEdit(
    action.path,
    action.search,
    action.replace,
    action.replaceAll,
  );

  const searchLines = action.search.split('\n');
  const replaceLines = action.replace.split('\n');

  if (result.status === 'applied') {
    step.updateResult(true, searchLines.length, replaceLines.length);
    step.diff(searchLines, replaceLines);
  } else if (result.status === 'already_applied') {
    step.success('Already applied (skipped)');
  } else if (result.status === 'not_found') {
    step.updateResult(false, 0, 0);
    if (result.message?.includes('File not found')) {
      step.error(
        `File not found: ${action.path}. Use <read> to check if file exists, or <write> to make a new file.`,
      );
    } else {
      step.error(
        `Pattern not found. Use <read path="${action.path}"/> first to see the actual content.`,
      );
    }
  } else {
    step.updateResult(false, 0, 0);
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

export async function executeMultiEdit(
  action: MultiEditAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMultiEdit && !handlers.onEdit) return null;

  step.update(action.path);

  let result: any;
  if (handlers.onMultiEdit) {
    result = await handlers.onMultiEdit(action.path, action.edits);
  } else {
    // Fallback: execute edits sequentially with diff collection
    const diffs: Array<{ search: string[]; replace: string[]; startLine: number }> = [];
    for (const edit of action.edits) {
      result = await handlers.onEdit!(action.path, edit.search, edit.replace, edit.replaceAll);
      if (!result.success && result.status !== 'already_applied') {
        break;
      }
      diffs.push({
        search: edit.search.split('\n'),
        replace: edit.replace.split('\n'),
        startLine: 1,
      });
    }
    result = result || { success: true, status: 'applied' as const, message: 'OK', diffs };
  }

  if (result.success && result.status === 'applied') {
    step.updateResult(true, action.edits.length, action.edits.length);

    // Display diffs for each edit with line numbers
    if (result.diffs && result.diffs.length > 0) {
      for (let i = 0; i < result.diffs.length; i++) {
        const diff = result.diffs[i];
        if (result.diffs.length > 1) {
          step.result(`Edit ${i + 1}/${result.diffs.length}`);
        }
        step.diff(diff.search, diff.replace, action.path, diff.startLine);
      }
    }
  } else if (result.status === 'already_applied') {
    step.success('Already applied (skipped)');
  } else {
    step.error(result.message || 'Multi-edit failed');
  }

  return {
    action: `MultiEdit: ${action.path}`,
    success: result.success,
    result: result.success
      ? result.status === 'already_applied'
        ? 'Skipped (already applied)'
        : `Applied ${action.edits.length} edits`
      : 'Failed',
    error: result.success ? undefined : result.message,
  };
}

export async function executeWrite(
  action: WriteAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const handler = handlers.onWrite || handlers.onCreate;
  if (!handler) return null;

  step.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  step.writeResult(success, lineCount);

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

  step.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  step.writeResult(success, lineCount);

  return {
    action: `Write: ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to create file',
  };
}
