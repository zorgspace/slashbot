/**
 * Plan Action Handler - Plan management operations
 */

import type { ActionResult, ActionHandlers, PlanAction } from '../types';
import { step, stickyPlan, colors } from '../../ui/colors';

export async function executePlan(
  action: PlanAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onPlan) return null;

  // Silent plan updates - no verbose logging
  try {
    const result = await handlers.onPlan(action.operation, {
      id: action.id,
      content: action.content,
      description: action.description,
      status: action.status,
      question: action.question,
    });

    if (result.success && result.plan) {
      // Update sticky plan state
      stickyPlan.setItems(result.plan);

      // Show progress inline for status changes
      if (action.operation === 'show') {
        stickyPlan.print();
      } else if (action.operation === 'add') {
        // Show visual feedback when adding plan items
        const newItem = result.plan.find(i => i.content === action.content);
        if (newItem) {
          const truncated = newItem.content.length > 50 ? newItem.content.slice(0, 47) + '...' : newItem.content;
          console.log(`${colors.violet}●${colors.reset} ${colors.violet}Plan${colors.reset} ${colors.info}+${colors.reset} ${truncated}`);
        }
        // Show sticky plan line after adding all items
        stickyPlan.print();
      } else if (action.operation === 'complete') {
        // Show progress when completing steps
        const completed = result.plan.filter(i => i.status === 'completed').length;
        const total = result.plan.length;
        const filled = Math.round((completed / total) * 5);
        const bar = `\x1b[32m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(5 - filled)}\x1b[0m`;
        process.stdout.write(`${bar} ${completed}/${total} \x1b[32m✓\x1b[0m\n`);
      } else if (action.operation === 'update' && action.status === 'in_progress') {
        // Show current task when starting
        const item = result.plan.find(i => i.id === action.id);
        if (item) {
          process.stdout.write(`\x1b[33m◉\x1b[0m ${item.content.slice(0, 50)}\n`);
        }
      } else if (action.operation === 'clear') {
        stickyPlan.clear();
      }
    } else if (action.operation === 'ask' && result.question) {
      step.message(`❓ ${result.question}`);
    } else if (!result.success) {
      step.error(result.message);
    }

    return {
      action: `Plan: ${action.operation}`,
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Plan failed: ${errorMsg}`);
    return {
      action: `Plan: ${action.operation}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
