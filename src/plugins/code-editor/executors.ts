/**
 * Search & Quality Action Handlers - Glob, Grep, LS operations
 */

import type { ActionResult, ActionHandlers, GrepOptions } from '../../core/actions/types';
import type { GlobAction, GrepAction, LSAction } from './types';
import { display, formatToolAction } from '../../core/ui';

export async function executeGlob(
  action: GlobAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGlob) return null;

  const pathInfo = action.path ? `, "${action.path}"` : '';
  const detail = `"${action.pattern}"${pathInfo}`;

  try {
    const files = await handlers.onGlob(action.pattern, action.path);
    const summary = files.length === 0 ? 'no matches' : `${files.length} file${files.length > 1 ? 's' : ''}`;
    display.appendAssistantMessage(formatToolAction('Glob', detail, { success: true, summary }));

    return {
      action: `Glob: ${action.pattern}`,
      success: true,
      result: files.length > 0 ? files.join('\n') : 'No files found',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(formatToolAction('Glob', detail, { success: false, summary: errorMsg }));
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

  // Build options display string
  const opts: string[] = [];
  if (action.context) opts.push(`-C${action.context}`);
  if (action.contextBefore) opts.push(`-B${action.contextBefore}`);
  if (action.contextAfter) opts.push(`-A${action.contextAfter}`);
  if (action.caseInsensitive) opts.push('-i');
  if (action.lineNumbers) opts.push('-n');
  if (action.multiline) opts.push('-U');
  if (action.headLimit) opts.push(`limit:${action.headLimit}`);
  const optsStr = opts.length > 0 ? ` ${opts.join(' ')}` : '';
  const pathInfo = action.path ? ` in ${action.path}` : '';
  const globInfo = action.glob ? ` (${action.glob})` : '';
  const detail = action.pattern + optsStr + pathInfo + globInfo;

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
  const lines = grepResults ? grepResults.split('\n').filter(l => l.trim()) : [];
  const summary = lines.length === 0 ? 'no matches' : `${lines.length} match${lines.length > 1 ? 'es' : ''}`;

  display.appendAssistantMessage(formatToolAction('Grep', detail, { success: true, summary }));

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

  const ignoreInfo = action.ignore?.length ? ` (ignore: ${action.ignore.join(', ')})` : '';
  const detail = `${action.path}${ignoreInfo}`;

  try {
    const entries = await handlers.onLS(action.path, action.ignore);
    const summary = entries.length === 0 ? 'empty' : `${entries.length} entries`;
    display.appendAssistantMessage(formatToolAction('LS', detail, { success: true, summary }));

    return {
      action: `LS: ${action.path}`,
      success: true,
      result: entries.join('\n') || 'Empty directory',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(formatToolAction('LS', detail, { success: false, summary: errorMsg }));
    return {
      action: `ls: ${action.path}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
