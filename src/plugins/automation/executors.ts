import type { ActionHandlers, ActionResult } from '../../core/actions/types';
import { display, formatToolAction } from '../../core/ui';
import type {
  AutomationAddCronAction,
  AutomationAddWebhookAction,
  AutomationListAction,
  AutomationRemoveAction,
  AutomationRunAction,
  AutomationSetEnabledAction,
  AutomationStatusAction,
} from './types.actions';

type AutomationHandlers = ActionHandlers & {
  onAutomationStatus?: () => Promise<{
    running: boolean;
    total: number;
    enabled: number;
    cron: number;
    webhook: number;
  }>;
  onAutomationList?: () => Promise<any[]>;
  onAutomationAddCron?: (input: {
    name: string;
    expression: string;
    prompt: string;
    source?: string;
    targetId?: string;
  }) => Promise<{ id: string; name: string; trigger: { type: 'cron'; expression: string } }>;
  onAutomationAddWebhook?: (input: {
    name: string;
    webhookName: string;
    prompt: string;
    secret?: string;
    source?: string;
    targetId?: string;
  }) => Promise<{ id: string; name: string; trigger: { type: 'webhook'; name: string } }>;
  onAutomationRun?: (selector: string) => Promise<{ id: string; name: string } | null>;
  onAutomationRemove?: (selector: string) => Promise<boolean>;
  onAutomationSetEnabled?: (
    selector: string,
    enabled: boolean,
  ) => Promise<{ id: string; name: string; enabled: boolean } | null>;
};

function compact(value: unknown): string {
  return String(value || '').trim();
}

function formatTarget(source?: string, targetId?: string): string {
  const normalizedSource = compact(source).toLowerCase();
  if (!normalizedSource || normalizedSource === 'none' || normalizedSource === '-') {
    return 'none';
  }
  const normalizedTargetId = compact(targetId);
  return normalizedTargetId ? `${normalizedSource}:${normalizedTargetId}` : normalizedSource;
}

export async function executeAutomationStatus(
  _action: AutomationStatusAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationStatus) return null;

  const summary = await automationHandlers.onAutomationStatus();
  display.appendAssistantMessage(
    formatToolAction('AutomationStatus', 'summary', {
      success: true,
      summary: `${summary.enabled}/${summary.total} enabled`,
    }),
  );

  return {
    action: 'AutomationStatus',
    success: true,
    result: [
      `running=${summary.running}`,
      `total=${summary.total}`,
      `enabled=${summary.enabled}`,
      `cron=${summary.cron}`,
      `webhook=${summary.webhook}`,
    ].join('\n'),
  };
}

export async function executeAutomationList(
  _action: AutomationListAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationList) return null;

  const list = await automationHandlers.onAutomationList();
  const jobs = Array.isArray(list) ? list : [];
  display.appendAssistantMessage(
    formatToolAction('AutomationList', `${jobs.length} jobs`, {
      success: true,
    }),
  );

  if (jobs.length === 0) {
    return {
      action: 'AutomationList',
      success: true,
      result: 'No automation jobs configured.',
    };
  }

  return {
    action: 'AutomationList',
    success: true,
    result: jobs
      .map((job: any) => {
        const trigger =
          job?.trigger?.type === 'cron'
            ? `cron:${job.trigger.expression || 'n/a'}`
            : `webhook:${job?.trigger?.name || 'n/a'}`;
        const target = job?.target
          ? `${job.target.source}${job.target.targetId ? `:${job.target.targetId}` : ''}`
          : 'none';
        return `${job.id} | ${job.name} | enabled=${!!job.enabled} | trigger=${trigger} | target=${target}`;
      })
      .join('\n'),
  };
}

export async function executeAutomationAddCron(
  action: AutomationAddCronAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationAddCron) return null;

  const name = compact(action.name);
  const expression = compact(action.expression);
  const prompt = compact(action.prompt);
  if (!name || !expression || !prompt) {
    return {
      action: 'AutomationAddCron',
      success: false,
      result: 'Blocked',
      error: 'name, expression, and prompt are required',
    };
  }

  try {
    const created = await automationHandlers.onAutomationAddCron({
      name,
      expression,
      prompt,
      source: compact(action.source) || undefined,
      targetId: compact(action.targetId) || undefined,
    });
    display.appendAssistantMessage(
      formatToolAction('AutomationAddCron', `${name} (${expression})`, {
        success: true,
        summary: created.id,
      }),
    );
    return {
      action: `AutomationAddCron: ${name}`,
      success: true,
      result: `Created cron job ${created.name} (${created.id}) with target=${formatTarget(action.source, action.targetId)}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction('AutomationAddCron', `${name} (${expression})`, {
        success: false,
        summary: errorMessage,
      }),
    );
    return {
      action: `AutomationAddCron: ${name}`,
      success: false,
      result: 'Failed',
      error: errorMessage,
    };
  }
}

export async function executeAutomationAddWebhook(
  action: AutomationAddWebhookAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationAddWebhook) return null;

  const name = compact(action.name);
  const webhookName = compact(action.webhookName).toLowerCase();
  const prompt = compact(action.prompt);
  if (!name || !webhookName || !prompt) {
    return {
      action: 'AutomationAddWebhook',
      success: false,
      result: 'Blocked',
      error: 'name, webhookName, and prompt are required',
    };
  }

  try {
    const created = await automationHandlers.onAutomationAddWebhook({
      name,
      webhookName,
      prompt,
      secret: compact(action.secret) || undefined,
      source: compact(action.source) || undefined,
      targetId: compact(action.targetId) || undefined,
    });
    display.appendAssistantMessage(
      formatToolAction('AutomationAddWebhook', `${name} (${webhookName})`, {
        success: true,
        summary: created.id,
      }),
    );
    return {
      action: `AutomationAddWebhook: ${name}`,
      success: true,
      result: `Created webhook job ${created.name} (${created.id}) with target=${formatTarget(action.source, action.targetId)}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction('AutomationAddWebhook', `${name} (${webhookName})`, {
        success: false,
        summary: errorMessage,
      }),
    );
    return {
      action: `AutomationAddWebhook: ${name}`,
      success: false,
      result: 'Failed',
      error: errorMessage,
    };
  }
}

export async function executeAutomationRun(
  action: AutomationRunAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationRun) return null;

  const selector = compact(action.selector);
  if (!selector) {
    return {
      action: 'AutomationRun',
      success: false,
      result: 'Blocked',
      error: 'selector is required',
    };
  }

  const job = await automationHandlers.onAutomationRun(selector);
  if (!job) {
    display.appendAssistantMessage(
      formatToolAction('AutomationRun', selector, {
        success: false,
        summary: 'not found',
      }),
    );
    return {
      action: `AutomationRun: ${selector}`,
      success: false,
      result: 'Failed',
      error: `Job not found: ${selector}`,
    };
  }

  display.appendAssistantMessage(
    formatToolAction('AutomationRun', selector, {
      success: true,
      summary: job.id,
    }),
  );
  return {
    action: `AutomationRun: ${selector}`,
    success: true,
    result: `Executed job ${job.name} (${job.id})`,
  };
}

export async function executeAutomationRemove(
  action: AutomationRemoveAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationRemove) return null;

  const selector = compact(action.selector);
  if (!selector) {
    return {
      action: 'AutomationRemove',
      success: false,
      result: 'Blocked',
      error: 'selector is required',
    };
  }

  const removed = await automationHandlers.onAutomationRemove(selector);
  display.appendAssistantMessage(
    formatToolAction('AutomationRemove', selector, {
      success: removed,
      summary: removed ? 'removed' : 'not found',
    }),
  );
  return {
    action: `AutomationRemove: ${selector}`,
    success: removed,
    result: removed ? `Removed job ${selector}` : 'Failed',
    error: removed ? undefined : `Job not found: ${selector}`,
  };
}

export async function executeAutomationSetEnabled(
  action: AutomationSetEnabledAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const automationHandlers = handlers as AutomationHandlers;
  if (!automationHandlers.onAutomationSetEnabled) return null;

  const selector = compact(action.selector);
  if (!selector) {
    return {
      action: 'AutomationSetEnabled',
      success: false,
      result: 'Blocked',
      error: 'selector is required',
    };
  }

  const updated = await automationHandlers.onAutomationSetEnabled(selector, !!action.enabled);
  const verb = action.enabled ? 'enable' : 'disable';
  display.appendAssistantMessage(
    formatToolAction('AutomationSetEnabled', `${verb} ${selector}`, {
      success: !!updated,
      summary: updated ? updated.id : 'not found',
    }),
  );
  return {
    action: `AutomationSetEnabled: ${selector}`,
    success: !!updated,
    result: updated ? `${action.enabled ? 'Enabled' : 'Disabled'} job ${updated.name} (${updated.id})` : 'Failed',
    error: updated ? undefined : `Job not found: ${selector}`,
  };
}
