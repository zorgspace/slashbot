/**
 * Action Executor - Execute parsed actions with live progress display
 */

import type { Action, ActionResult, ActionHandlers } from './types';
import { plan } from '../ui/colors';

/**
 * Actions that appear in the plan (impactful actions only)
 */
const PLAN_ACTIONS = ['edit', 'create', 'exec', 'schedule', 'notify'];

/**
 * Get a human-readable label for a plan action
 */
function getActionLabel(action: Action): string {
  switch (action.type) {
    case 'edit':
      return `Edit ${action.path}`;
    case 'create':
      return `Create ${action.path}`;
    case 'exec':
      return action.command.slice(0, 50) + (action.command.length > 50 ? '...' : '');
    case 'schedule':
      return `Schedule ${action.name}`;
    case 'notify':
      return `Notify ${action.service}`;
    default:
      return '';
  }
}

/**
 * Generate unique ID for an action
 */
function getActionId(action: Action, index: number): string {
  return `${action.type}-${index}-${Date.now()}`;
}

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

  // Execute each action
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const id = getActionId(action, i);
    const showInPlan = PLAN_ACTIONS.includes(action.type);

    // Only add impactful actions to the plan
    if (showInPlan) {
      plan.addStep(id, getActionLabel(action));
      plan.markRunning(id);
    }

    const result = await executeAction(action, handlers);

    if (result) {
      if (showInPlan) {
        if (result.success) {
          plan.markDone(id);
        } else {
          plan.markError(id);
        }
      }
      results.push(result);
    } else if (showInPlan) {
      plan.markDone(id);
    }
  }

  // Hide the plan after completion
  if (plan.isComplete()) {
    await new Promise(resolve => setTimeout(resolve, 200));
    plan.hide();
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
    default:
      return null;
  }
}

async function executeGrep(
  action: Extract<Action, { type: 'grep' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onGrep) return null;
  const grepResults = await handlers.onGrep(action.pattern, action.filePattern);
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
  const fileContent = await handlers.onRead(action.path);

  if (fileContent) {
    const preview = fileContent.length > 1000 ? fileContent.slice(0, 1000) + '...' : fileContent;
    return { action: `READ ${action.path}`, success: true, result: preview };
  } else {
    return { action: `READ ${action.path}`, success: false, result: 'File not found', error: 'File not found' };
  }
}

async function executeEdit(
  action: Extract<Action, { type: 'edit' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onEdit) return null;
  const success = await handlers.onEdit(action.path, action.search, action.replace);
  return {
    action: `EDIT ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Pattern not found',
  };
}

async function executeCreate(
  action: Extract<Action, { type: 'create' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onCreate) return null;
  const success = await handlers.onCreate(action.path, action.content);
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
  const output = await handlers.onExec(action.command);
  const isError = output?.startsWith('Error:');
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
  await handlers.onSchedule(action.cron, action.command, action.name, action.notify);
  const notifyInfo = action.notify && action.notify !== 'none' ? ` (notify: ${action.notify})` : '';
  return {
    action: `SCHEDULE ${action.name}`,
    success: true,
    result: `Scheduled: ${action.cron}${notifyInfo}`,
  };
}

async function executeNotify(
  action: Extract<Action, { type: 'notify' }>,
  handlers: ActionHandlers
): Promise<ActionResult | null> {
  if (!handlers.onNotify) return null;
  await handlers.onNotify(action.service, action.message);
  return {
    action: `NOTIFY ${action.service}`,
    success: true,
    result: 'Sent',
  };
}
