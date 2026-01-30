/**
 * Action Executor - Execute parsed actions with Claude Code-style display
 */

import type { Action, ActionResult, ActionHandlers, GrepOptions } from './types';
import { step } from '../ui/colors';

/**
 * Execute a list of actions and return results
 */
export async function executeActions(
  actions: Action[],
  handlers: ActionHandlers
): Promise<ActionResult[]> {
  if (actions.length === 0) {
    return [];
  }

  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

async function executeAction(
  action: Action,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  switch (action.type) {
    case 'grep':
      return executeGrep(action, handlers);
    case 'read':
      return executeRead(action, handlers);
    case 'edit':
      return executeEdit(action, handlers);
    case 'create':
      return executeCreate(action, handlers);
    case 'exec':
      return executeExec(action, handlers);
    case 'schedule':
      return executeSchedule(action, handlers);
    case 'notify':
      return executeNotify(action, handlers);
    case 'glob':
      return executeGlob(action, handlers);
    case 'git':
      return executeGit(action, handlers);
    case 'fetch':
      return executeFetch(action, handlers);
    case 'format':
      return executeFormat(action, handlers);
    case 'typecheck':
      return executeTypecheck(action, handlers);
    case 'search':
      return executeSearch(action, handlers);
    case 'skill':
      return executeSkill(action, handlers);
    case 'skill-install':
      return executeSkillInstall(action, handlers);
    default:
      return null;
  }
}

async function executeGrep(
  action: Extract<Action, { type: 'grep' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onGrep) return null;

  // Build options display string
  const opts: string[] = [];
  if (action.context) opts.push(`-C${action.context}`);
  if (action.contextBefore) opts.push(`-B${action.contextBefore}`);
  if (action.contextAfter) opts.push(`-A${action.contextAfter}`);
  if (action.caseInsensitive) opts.push('-i');
  const optsStr = opts.length > 0 ? ` ${opts.join(' ')}` : '';

  // Display action in Claude Code style
  step.grep(action.pattern + optsStr, action.filePattern);

  // Build options for handler
  const grepOptions: GrepOptions = {
    context: action.context,
    contextBefore: action.contextBefore,
    contextAfter: action.contextAfter,
    caseInsensitive: action.caseInsensitive,
  };

  const grepResults = await handlers.onGrep(action.pattern, action.filePattern, grepOptions);
  const lines = grepResults ? grepResults.split('\n').filter(l => l.trim()) : [];

  // Display result
  step.grepResult(lines.length, lines.length > 0 ? lines.slice(0, 5).join('\n') : undefined);

  return {
    action: `GREP ${action.pattern}`,
    success: true,
    result: grepResults || 'No results',
  };
}

async function executeRead(
  action: Extract<Action, { type: 'read' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onRead) return null;

  // Display action in Claude Code style
  step.read(action.path);

  const fileContent = await handlers.onRead(action.path);

  if (fileContent) {
    const lineCount = fileContent.split('\n').length;
    step.readResult(lineCount);
    const preview = fileContent.length > 1000 ? fileContent.slice(0, 1000) + '...' : fileContent;
    return { action: `READ ${action.path}`, success: true, result: preview };
  } else {
    step.error('File not found');
    return { action: `READ ${action.path}`, success: false, result: 'File not found', error: 'File not found' };
  }
}

async function executeEdit(
  action: Extract<Action, { type: 'edit' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onEdit) return null;

  // Display action in Claude Code style
  step.update(action.path);

  const result = await handlers.onEdit(action.path, action.search, action.replace);

  // Calculate diff info
  const searchLines = action.search.split('\n');
  const replaceLines = action.replace.split('\n');

  if (result.status === 'applied') {
    // Show diff with removed/added lines
    step.updateResult(true, searchLines.length, replaceLines.length);
    step.diff(searchLines, replaceLines);
  } else if (result.status === 'already_applied') {
    // Edit was already applied - skip display, just note it
    step.success('Already applied (skipped)');
  } else {
    step.updateResult(false, 0, 0);
  }

  return {
    action: `EDIT ${action.path}`,
    success: result.success,
    result: result.status === 'already_applied' ? 'Skipped (already applied)' : (result.success ? 'OK' : 'Failed'),
    error: result.success ? undefined : result.message,
  };
}

async function executeCreate(
  action: Extract<Action, { type: 'create' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onCreate) return null;

  // Display action in Claude Code style
  step.write(action.path);

  const success = await handlers.onCreate(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  step.writeResult(success, lineCount);

  return {
    action: `CREATE ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to create file',
  };
}

async function executeExec(
  action: Extract<Action, { type: 'exec' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onExec) return null;

  // Display action in Claude Code style
  step.bash(action.command);

  const output = await handlers.onExec(action.command);
  const isError = output?.startsWith('Error:') || output?.includes('Command blocked');

  // Display result
  if (isError) {
    step.bashResult(action.command, output || '', 1);
  } else {
    step.bashResult(action.command, output || '', 0);
  }

  return {
    action: `EXEC ${action.command}`,
    success: !isError,
    result: output || 'OK',
    error: isError ? output : undefined,
  };
}

async function executeSchedule(
  action: Extract<Action, { type: 'schedule' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onSchedule) return null;

  // Display action in Claude Code style
  step.schedule(action.name, action.cron);

  await handlers.onSchedule(action.cron, action.command, action.name);

  step.success(`Scheduled: ${action.cron}`);

  return {
    action: `SCHEDULE ${action.name}`,
    success: true,
    result: `Scheduled: ${action.cron}`,
  };
}

async function executeNotify(
  action: Extract<Action, { type: 'notify' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onNotify) {
    step.error('No connectors configured');
    return {
      action: 'NOTIFY',
      success: false,
      result: 'No connectors available',
      error: 'Configure Telegram or Discord',
    };
  }

  // Display action
  const targetInfo = action.target ? ` to ${action.target}` : ' to all';
  step.thinking(`Sending${targetInfo}...`);

  try {
    const result = await handlers.onNotify(action.message, action.target);

    if (result.sent.length > 0) {
      step.success(`Sent to: ${result.sent.join(', ')}`);
    }
    if (result.failed.length > 0) {
      step.error(`Failed: ${result.failed.join(', ')}`);
    }

    return {
      action: 'NOTIFY',
      success: result.sent.length > 0,
      result: result.sent.length > 0
        ? `Sent to ${result.sent.join(', ')}`
        : 'No messages sent',
      error: result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Notify failed: ${errorMsg}`);
    return {
      action: 'NOTIFY',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeGlob(
  action: Extract<Action, { type: 'glob' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onGlob) return null;

  // Display action in Claude Code style
  const pathInfo = action.path ? `, "${action.path}"` : '';
  step.tool('Glob', `"${action.pattern}"${pathInfo}`);

  try {
    const files = await handlers.onGlob(action.pattern, action.path);

    // Display results
    if (files.length === 0) {
      step.result('No files found');
    } else {
      const preview = files.slice(0, 10).join('\n');
      step.result(`Found ${files.length} file${files.length > 1 ? 's' : ''}\n${preview}${files.length > 10 ? `\n... and ${files.length - 10} more` : ''}`);
    }

    return {
      action: `GLOB ${action.pattern}`,
      success: true,
      result: files.length > 0 ? files.join('\n') : 'No files found',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Glob failed: ${errorMsg}`);
    return {
      action: `GLOB ${action.pattern}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeGit(
  action: Extract<Action, { type: 'git' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onGit) return null;

  // Display action in Claude Code style
  const argsInfo = action.args ? ` ${action.args}` : '';
  step.tool('Git', `${action.command}${argsInfo}`);

  try {
    const output = await handlers.onGit(action.command, action.args);
    const lines = output.split('\n').filter(l => l.trim());
    const isError = output.startsWith('Error:') || output.includes('fatal:');

    if (isError) {
      step.error(output.slice(0, 100));
    } else {
      const preview = lines.slice(0, 8).join('\n');
      step.result(`${lines.length} line${lines.length !== 1 ? 's' : ''}\n${preview}${lines.length > 8 ? `\n... and ${lines.length - 8} more` : ''}`);
    }

    return {
      action: `GIT ${action.command}`,
      success: !isError,
      result: output || 'OK',
      error: isError ? output : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Git failed: ${errorMsg}`);
    return {
      action: `GIT ${action.command}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeFetch(
  action: Extract<Action, { type: 'fetch' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onFetch) return null;

  // Display action in Claude Code style
  const shortUrl = action.url.length > 50 ? action.url.slice(0, 47) + '...' : action.url;
  const promptInfo = action.prompt ? `, "${action.prompt.slice(0, 30)}..."` : '';
  step.tool('Fetch', `${shortUrl}${promptInfo}`);

  try {
    const content = await handlers.onFetch(action.url, action.prompt);
    const lines = content.split('\n').length;
    const charCount = content.length;

    step.result(`Fetched ${charCount} chars, ${lines} lines`);

    return {
      action: `FETCH ${action.url}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Fetch failed: ${errorMsg}`);
    return {
      action: `FETCH ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeFormat(
  action: Extract<Action, { type: 'format' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onFormat) return null;

  const pathInfo = action.path ? `(${action.path})` : '';
  step.tool('Format', pathInfo);

  try {
    const output = await handlers.onFormat(action.path);
    step.result(output || 'Formatted');

    return {
      action: 'FORMAT',
      success: true,
      result: output || 'OK',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Format failed: ${errorMsg}`);
    return {
      action: 'FORMAT',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeTypecheck(
  action: Extract<Action, { type: 'typecheck' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onTypecheck) return null;

  step.tool('Typecheck', '');

  try {
    const output = await handlers.onTypecheck();
    const hasErrors = output.includes('error') || output.includes('Error');

    if (hasErrors) {
      step.result(output, true);
    } else {
      step.result(output || 'No errors');
    }

    return {
      action: 'TYPECHECK',
      success: !hasErrors,
      result: output || 'OK',
      error: hasErrors ? output : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Typecheck failed: ${errorMsg}`);
    return {
      action: 'TYPECHECK',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeSearch(
  action: Extract<Action, { type: 'search' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onSearch) return null;

  const xInfo = action.xSearch ? ' (+ X/Twitter)' : '';
  step.tool('Search', `"${action.query}"${xInfo}`);

  try {
    const { response, citations } = await handlers.onSearch(action.query, { xSearch: action.xSearch });

    // Show citations if any
    if (citations.length > 0) {
      const citationPreview = citations.slice(0, 3).join(', ');
      step.result(`Found ${citations.length} sources: ${citationPreview}${citations.length > 3 ? '...' : ''}`);
    } else {
      step.result('Search completed');
    }

    return {
      action: `SEARCH ${action.query}`,
      success: true,
      result: response,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Search failed: ${errorMsg}`);
    return {
      action: `SEARCH ${action.query}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeSkill(
  action: Extract<Action, { type: 'skill' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onSkill) return null;

  const argsInfo = action.args ? ` "${action.args}"` : '';
  step.tool('Skill', `${action.name}${argsInfo}`);

  try {
    const content = await handlers.onSkill(action.name, action.args);

    step.result(`Loaded skill: ${action.name}`);

    return {
      action: `SKILL ${action.name}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill failed: ${errorMsg}`);
    return {
      action: `SKILL ${action.name}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeSkillInstall(
  action: Extract<Action, { type: 'skill-install' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onSkillInstall) return null;

  const nameInfo = action.name ? ` as "${action.name}"` : '';
  step.tool('SkillInstall', `${action.url}${nameInfo}`);

  try {
    const result = await handlers.onSkillInstall(action.url, action.name);

    step.result(`Installed skill: ${result.name} → ${result.path}`);

    return {
      action: `SKILL-INSTALL ${action.url}`,
      success: true,
      result: `Skill "${result.name}" installed at ${result.path}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill install failed: ${errorMsg}`);
    return {
      action: `SKILL-INSTALL ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

