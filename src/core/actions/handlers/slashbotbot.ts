/**
 * Dashbot Handler - Execute parallel sub-agents
 */

import type { SlashbotbotAction, ActionResult, ActionHandlers } from '../types';

export async function executeSlashbotbot(
  action: SlashbotbotAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  if (!handlers.onTask) {
    return {
      action: 'dashbot',
      success: false,
      result: 'Task handler not available',
    };
  }

  try {
    // Run all sub-tasks in parallel
    const taskPromises = action.bots.map(bot =>
      handlers.onTask!(bot.prompt, bot.description)
    );

    const results = await Promise.all(taskPromises);

    // Combine results
    const combinedResult = results.join('\n\n--- Dashbot Result Separator ---\n\n');

    return {
      action: 'dashbot',
      success: true,
      result: `Parallel sub-agents completed:\n\n${combinedResult}`,
    };
  } catch (error) {
    return {
      action: 'dashbot',
      success: false,
      result: `Failed to execute parallel sub-agents: ${(error as Error).message}`,
    };
  }
}