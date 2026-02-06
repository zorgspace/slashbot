/**
 * Action Executor - Execute parsed actions using dynamic plugin-based dispatch.
 * All action handlers are contributed by plugins via setDynamicExecutorMap().
 */

import type { Action, ActionResult, ActionHandlers } from './types';

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
 * Execute actions one at a time to allow LLM to adapt based on results.
 * This saves tokens by not pre-executing all actions at once.
 *
 * @param actions - List of actions to execute
 * @param handlers - Action handlers
 * @param oneAtATime - If true, only execute the first action (default: true)
 */
export async function executeActions(
  actions: Action[],
  handlers: ActionHandlers,
  oneAtATime: boolean = true,
): Promise<ActionResult[]> {
  if (actions.length === 0) {
    return [];
  }

  const results: ActionResult[] = [];

  // Transparent actions (say, continue) always execute — they don't consume the slot
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

  // Apply oneAtATime only to real actions
  const realToExecute = oneAtATime && real.length > 0 ? [real[0]] : real;

  for (const action of realToExecute) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
    }
  }

  // If real actions were skipped due to oneAtATime, add a notice
  const skippedReal = oneAtATime ? real.slice(1) : [];
  if (skippedReal.length > 0 && results.length > 0) {
    const skippedActions = skippedReal.map(a => {
      if (a.type === 'exec') return `exec: ${(a as any).command}`;
      return a.type;
    });
    const skippedNote = `\n\n[PENDING: ${skippedReal.length} action(s) not yet executed: ${skippedActions.join(', ')}. Execute them one at a time in subsequent responses.]`;
    results[results.length - 1].result += skippedNote;
  }

  return results;
}

async function executeAction(
  action: Action,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  // Dispatch via dynamic executor map (plugin contributions)
  if (dynamicExecutorMap) {
    const executor = dynamicExecutorMap.get(action.type);
    if (executor) {
      return executor(action, handlers);
    }
  }

  // No handler found for this action type
  return null;
}
