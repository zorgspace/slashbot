/**
 * Action Executor - Execute parsed actions with Claude Code-style display
 */

import type { Action, ActionResult, ActionHandlers } from './types';
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
    case 'skill':
      return executeSkill(action, handlers);
    case 'telegram':
      return executeTelegram(action, handlers);
    case 'web':
      return executeWeb(action, handlers);
    case 'fetch':
      return executeFetch(action, handlers);
    default:
      return null;
  }
}

async function executeGrep(
  action: Extract<Action, { type: 'grep' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onGrep) return null;

  // Display action in Claude Code style
  step.grep(action.pattern, action.filePattern);

  const grepResults = await handlers.onGrep(action.pattern, action.filePattern);
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

  // Check if this is a skill file
  const isSkill = action.path.includes('.slashbot/skills/') && action.path.endsWith('.md');

  if (isSkill) {
    // Extract skill name from path
    const skillName = action.path.split('/').pop()?.replace('.md', '') || action.path;
    step.skill(skillName);
  } else {
    // Display action in Claude Code style
    step.read(action.path);
  }

  const fileContent = await handlers.onRead(action.path);

  if (fileContent) {
    const lineCount = fileContent.split('\n').length;
    if (isSkill) {
      step.success(`Loaded skill (${lineCount} lines)`);
    } else {
      step.readResult(lineCount);
    }
    const preview = fileContent.length > 1000 ? fileContent.slice(0, 1000) + '...' : fileContent;
    return { action: isSkill ? `SKILL ${action.path}` : `READ ${action.path}`, success: true, result: preview };
  } else {
    step.error(isSkill ? 'Skill not found' : 'File not found');
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

async function executeSkill(
  action: Extract<Action, { type: 'skill' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onSkill) return null;

  // Display action in Claude Code style
  step.skill(action.name);

  try {
    const context = await handlers.onSkill(action.name);
    const lineCount = context.split('\n').length;
    step.success(`Loaded context (${lineCount} lines)`);
    return {
      action: `SKILL ${action.name}`,
      success: true,
      result: context,
    };
  } catch (error) {
    step.error(`Skill "${action.name}" not found`);
    return {
      action: `SKILL ${action.name}`,
      success: false,
      result: 'Skill not found',
      error: `Skill "${action.name}" not found`,
    };
  }
}

async function executeTelegram(
  action: Extract<Action, { type: 'telegram' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onTelegram) {
    step.error('Telegram not configured');
    return {
      action: 'TELEGRAM',
      success: false,
      result: 'Telegram not configured',
      error: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID',
    };
  }

  // Display action
  step.thinking('Sending to Telegram...');

  try {
    await handlers.onTelegram(action.message);
    step.success('Message sent to Telegram');
    return {
      action: 'TELEGRAM',
      success: true,
      result: 'Message sent',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Telegram failed: ${errorMsg}`);
    return {
      action: 'TELEGRAM',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeWeb(
  action: Extract<Action, { type: 'web' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onWebSearch) {
    step.error('Web search not configured');
    return {
      action: 'WEB',
      success: false,
      result: 'Web search not available',
      error: 'onWebSearch handler not configured',
    };
  }

  // Display action
  step.thinking(`Searching: ${action.query.slice(0, 50)}...`);

  try {
    const results = await handlers.onWebSearch(action.query);
    const lineCount = results.split('\n').length;
    step.success(`Found results (${lineCount} lines)`);
    return {
      action: `WEB ${action.query}`,
      success: true,
      result: results,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Search failed: ${errorMsg}`);
    return {
      action: `WEB ${action.query}`,
      success: false,
      result: 'Search failed',
      error: errorMsg,
    };
  }
}

async function executeFetch(
  action: Extract<Action, { type: 'fetch' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onFetch) {
    step.error('Fetch not configured');
    return {
      action: 'FETCH',
      success: false,
      result: 'Fetch not available',
      error: 'onFetch handler not configured',
    };
  }

  // Display action
  const shortUrl = action.url.length > 50 ? action.url.slice(0, 50) + '...' : action.url;
  step.thinking(`Fetching: ${shortUrl}`);

  try {
    const content = await handlers.onFetch(action.url);
    const charCount = content.length;
    step.success(`Fetched (${charCount} chars)`);
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
      result: 'Fetch failed',
      error: errorMsg,
    };
  }
}
