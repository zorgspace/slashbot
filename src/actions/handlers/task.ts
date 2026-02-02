/**
 * Task Action Handler - Sub-task spawning
 */

import type { ActionResult, ActionHandlers, TaskAction } from '../types';
import { step } from '../../ui/colors';

export async function executeTask(
  action: TaskAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTask) return null;

  const desc =
    action.description || action.prompt.slice(0, 50) + (action.prompt.length > 50 ? '...' : '');
  step.tool('Task', desc);

  try {
    const result = await handlers.onTask(action.prompt, action.description);

    step.result(`Sub-task completed`);

    return {
      action: `Task: ${desc}`,
      success: true,
      result,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Task failed: ${errorMsg}`);
    return {
      action: `Task: ${desc}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
