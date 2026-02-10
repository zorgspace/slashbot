/**
 * Action Executor - Execute parsed actions using dynamic plugin-based dispatch.
 * All action handlers are contributed by plugins via setDynamicExecutorMap().
 */

import type { Action, ActionResult, ActionHandlers } from './types';
import { display } from '../ui';

/**
 * Dynamic executor map from plugin contributions.
 */
let dynamicExecutorMap: Map<
  string,
  (action: Action, handlers: ActionHandlers) => Promise<ActionResult | null>
> | null = null;

/**
 * Set the dynamic executor map from plugin contributions
 */
export function setDynamicExecutorMap(
  map: Map<string, (action: Action, handlers: ActionHandlers) => Promise<ActionResult | null>>,
): void {
  dynamicExecutorMap = map;
}

/**
 * Execute all parsed actions sequentially in the order the LLM listed them.
 * Transparent actions (say, continue) execute first, then real actions.
 *
 * @param actions - List of actions to execute
 * @param handlers - Action handlers
 */
import { container } from '../di/container';
import { TYPES } from '../di/types';
import type { HooksManager } from '../utils/hooks';

export async function executeActions(
  actions: Action[],
  handlers: ActionHandlers,
): Promise<ActionResult[]> {
  const hooks = container.get<HooksManager>(TYPES.HooksManager);
  await hooks.trigger('actionsStart', { count: actions.length });
  if (actions.length === 0) {
    await hooks.trigger('actionsEnd', { count: 0 });
    return [];
  }

  const results: ActionResult[] = [];

  // Transparent actions (say, continue) always execute first
  const TRANSPARENT_TYPES = new Set(['say', 'continue']);
  const transparent = actions.filter(a => TRANSPARENT_TYPES.has(a.type));
  const real = actions.filter(a => !TRANSPARENT_TYPES.has(a.type));

  // Execute all transparent actions first
  for (const action of transparent) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
    }
  }

  // Execute all real actions sequentially
  for (const action of real) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Build a human-readable description from an action for comm panel logging
 */
function describeAction(action: Action): string {
  const type = action.type;
  if (typeof action.command === 'string') return `${type}: ${action.command}`;
  if (typeof action.path === 'string') return `${type}: ${action.path}`;
  if (typeof action.pattern === 'string') return `${type}: ${action.pattern}`;
  return type;
}

async function executeAction(
  action: Action,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  // Log action to comm panel
  display.logAction(describeAction(action));

  // Dispatch via dynamic executor map (plugin contributions)
  if (dynamicExecutorMap) {
    const executor = dynamicExecutorMap.get(action.type);
    if (executor) {
      const t0 = Date.now();
      const result = await executor(action, handlers);
      return result;
    }
  }

  // No handler found for this action type
  return null;
}
