/**
 * Scheduling Action Handlers - Schedule and Notify operations
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { ScheduleAction, NotifyAction } from './types';
import { display, formatToolAction } from '../../core/ui';

export async function executeSchedule(
  action: ScheduleAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSchedule) return null;

  const isPrompt = !!action.prompt;
  const content = action.prompt || action.command || '';

  await handlers.onSchedule(action.cron, content, action.name, { isPrompt });

  display.appendAssistantMessage(
    formatToolAction('Schedule', `${action.name}, "${action.cron}"`, {
      success: true,
      summary: isPrompt ? 'AI task' : undefined,
    }),
  );

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
    display.error('No connectors configured');
    return {
      action: 'Notify',
      success: false,
      result: 'No connectors available',
      error: 'Configure Telegram or Discord',
    };
  }

  const targetInfo = action.target ? ` to ${action.target}` : ' to all';

  try {
    const result = await handlers.onNotify(action.message, action.target);

    if (result.sent.length > 0) {
      display.appendAssistantMessage(
        formatToolAction('Notify', targetInfo.trim(), { success: true, summary: result.sent.join(', ') }),
      );
    }
    if (result.failed.length > 0) {
      display.error(`Failed: ${result.failed.join(', ')}`);
    }

    return {
      action: 'Notify',
      success: result.sent.length > 0,
      result: result.sent.length > 0 ? `Sent to ${result.sent.join(', ')}` : 'No messages sent',
      error: result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction('Notify', targetInfo.trim(), { success: false, summary: errorMsg }),
    );
    return {
      action: 'Notify',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
