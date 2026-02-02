/**
 * Scheduling Action Handlers - Schedule and Notify operations
 */

import type { ActionResult, ActionHandlers, ScheduleAction, NotifyAction } from '../types';
import { step } from '../../ui/colors';

export async function executeSchedule(
  action: ScheduleAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSchedule) return null;

  const isPrompt = !!action.prompt;
  const content = action.prompt || action.command || '';

  step.schedule(action.name, action.cron);
  if (isPrompt) {
    step.thinking(`AI-powered task: ${content.slice(0, 50)}...`);
  }

  await handlers.onSchedule(action.cron, content, action.name, { isPrompt });

  step.success(`Scheduled: ${action.cron}${isPrompt ? ' (AI task)' : ''}`);

  return {
    action: `Schedule: ${action.name}`,
    success: true,
    result: `Scheduled: ${action.cron}${isPrompt ? ' (AI-powered)' : ''}`,
  };
}

export async function executeNotify(
  action: NotifyAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onNotify) {
    step.error('No connectors configured');
    return {
      action: 'Notify',
      success: false,
      result: 'No connectors available',
      error: 'Configure Telegram or Discord',
    };
  }

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
      action: 'Notify',
      success: result.sent.length > 0,
      result: result.sent.length > 0 ? `Sent to ${result.sent.join(', ')}` : 'No messages sent',
      error: result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Notify failed: ${errorMsg}`);
    return {
      action: 'Notify',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
