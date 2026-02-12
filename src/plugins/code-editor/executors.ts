/**
 * Search & Quality Action Handlers - Glob, Grep, LS operations
 */

import type { ActionResult, ActionHandlers, GrepOptions } from '../../core/actions/types';
import type { GlobAction, GrepAction, LSAction } from './types';
import { display } from '../../core/ui';

export async function executeGlob(
  action: GlobAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGlob) return null;

  try {
    const files = await handlers.onGlob(action.pattern, action.path);
    const meta = `pattern="${action.pattern}"${action.path ? ` path="${action.path}"` : ''}`;
    const fileList = files.join('\n');
    const hasFiles = files.length > 0;
    const globPayload = hasFiles ? fileList : 'No files found';
    const globResult = hasFiles ? fileList : `No files found (${meta})`;
    display.pushExploreProbe('Glob', globPayload, true, meta);

    return {
      action: `Glob: ${action.pattern}`,
      success: true,
      result: globResult,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const meta = `pattern="${action.pattern}"${action.path ? ` path="${action.path}"` : ''}`;
    display.pushExploreProbe('Glob', errorMsg, false, meta);
    return {
      action: `Glob: ${action.pattern}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

export async function executeGrep(
  action: GrepAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGrep) return null;

  // Build options for handler
  const grepOptions: GrepOptions = {
    path: action.path,
    glob: action.glob,
    outputMode: action.outputMode,
    context: action.context,
    contextBefore: action.contextBefore,
    contextAfter: action.contextAfter,
    caseInsensitive: action.caseInsensitive,
    lineNumbers: action.lineNumbers,
    headLimit: action.headLimit,
    multiline: action.multiline,
  };

  const grepResults = await handlers.onGrep(action.pattern, grepOptions);
  display.pushExploreProbe('Grep', grepResults || 'No results', true);

  return {
    action: `Grep: ${action.pattern}`,
    success: true,
    result: grepResults || 'No results',
  };
}

export async function executeLS(
  action: LSAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onLS) return null;

  try {
    const entries = await handlers.onLS(action.path, action.ignore);
    const lsPayload = entries.length > 0 ? entries.join('\n') : 'No entries found';
    display.pushExploreProbe('LS', lsPayload, true);

    return {
      action: `LS: ${action.path}`,
      success: true,
      result: entries.join('\n') || 'Empty directory',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.pushExploreProbe('LS', errorMsg, false);
    return {
      action: `ls: ${action.path}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
