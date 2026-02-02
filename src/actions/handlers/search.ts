/**
 * Search Action Handlers - Glob, Grep, LS operations
 */

import type {
  ActionResult,
  ActionHandlers,
  GlobAction,
  GrepAction,
  LSAction,
  GrepOptions,
} from '../types';
import { step } from '../../ui/colors';

export async function executeGlob(
  action: GlobAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGlob) return null;

  const pathInfo = action.path ? `, "${action.path}"` : '';
  step.tool('Glob', `"${action.pattern}"${pathInfo}`);

  try {
    const files = await handlers.onGlob(action.pattern, action.path);

    if (files.length === 0) {
      step.result('No files found');
    } else {
      step.result(`Found ${files.length} file${files.length > 1 ? 's' : ''}\n${files.join('\n')}`);
    }

    return {
      action: `Glob: ${action.pattern}`,
      success: true,
      result: files.length > 0 ? files.join('\n') : 'No files found',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Glob failed: ${errorMsg}`);
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

  step.grep(action.pattern + optsStr + pathInfo + globInfo);

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

  step.grepResult(lines.length, grepResults || undefined);

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
  step.tool('LS', `${action.path}${ignoreInfo}`);

  try {
    const entries = await handlers.onLS(action.path, action.ignore);

    if (entries.length === 0) {
      step.result('Empty directory');
    } else {
      step.result(`${entries.length} entries\n${entries.join('\n')}`);
    }

    return {
      action: `LS: ${action.path}`,
      success: true,
      result: entries.join('\n') || 'Empty directory',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`LS failed: ${errorMsg}`);
    return {
      action: `LS: ${action.path}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
