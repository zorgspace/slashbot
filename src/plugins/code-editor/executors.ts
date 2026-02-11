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
    display.pushExploreProbe('Glob', files.join('\n'), true);

    return {
      action: `Glob: ${action.pattern}`,
      success: true,
      result: files.length > 0 ? files.join('\n') : 'No files found',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.pushExploreProbe('Glob', errorMsg, false);
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
    display.pushExploreProbe('LS', entries.join('\n'), true);

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
