import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import type { AutomationService } from './services/AutomationService';

function resolveService(context: Parameters<CommandHandler['execute']>[1]): AutomationService | null {
  try {
    return context.container.get<AutomationService>(TYPES.AutomationService);
  } catch {
    return null;
  }
}

function inline(value: unknown): string {
  return display.formatInline(value).replace(/`/g, '');
}

function splitTarget(
  sourceArg: string | undefined,
  targetArg: string | undefined,
): { source: string; targetId?: string } | undefined {
  const source = String(sourceArg || '').trim().toLowerCase();
  if (!source || source === 'none' || source === '-') {
    return undefined;
  }
  const targetId = String(targetArg || '').trim();
  return {
    source,
    targetId: targetId && targetId !== '-' ? targetId : undefined,
  };
}

export const automationCommand: CommandHandler = {
  name: 'automation',
  aliases: ['auto'],
  description: 'Manage automation jobs (cron + webhook)',
  usage:
    '/automation [list|status|add-cron|add-webhook|run|remove|enable|disable] ...',
  group: 'Automation',
  subcommands: [
    'list',
    'status',
    'add-cron',
    'add-webhook',
    'run',
    'remove',
    'enable',
    'disable',
  ],
  execute: async (args, context) => {
    const service = resolveService(context);
    if (!service) {
      display.errorText('Automation service not available');
      return true;
    }

    const sub = (args[0] || 'list').toLowerCase();

    if (sub === 'status') {
      const summary = service.getSummary();
      display.renderMarkdown(
        [
          'Automation Status',
          '',
          `- running: ${inline(summary.running)}`,
          `- total jobs: ${inline(summary.total)}`,
          `- enabled jobs: ${inline(summary.enabled)}`,
          `- cron jobs: ${inline(summary.cron)}`,
          `- webhook jobs: ${inline(summary.webhook)}`,
        ].join('\n'),
        true,
      );
      return true;
    }

    if (sub === 'list' || sub === 'ls') {
      const jobs = service.listJobs();
      if (jobs.length === 0) {
        display.muted('No automation jobs configured');
        display.muted('Add one with /automation add-cron ...');
        return true;
      }

      const lines: string[] = ['Automation Jobs'];
      for (const job of jobs) {
        const trigger =
          job.trigger.type === 'cron'
            ? `cron: ${job.trigger.expression} (next: ${job.trigger.nextRunAt || 'n/a'})`
            : `webhook: ${job.trigger.name}`;
        const target = job.target
          ? `${job.target.source}${job.target.targetId ? `:${job.target.targetId}` : ''}`
          : 'none';
        lines.push('');
        lines.push(`- ${job.name} (${job.id})`);
        lines.push(`  enabled=${job.enabled} trigger=${trigger} target=${target}`);
        lines.push(`  last=${job.lastRunAt || 'never'} status=${job.lastStatus || 'n/a'}`);
      }
      display.renderMarkdown(lines.join('\n'), true);
      return true;
    }

    if (sub === 'add-cron') {
      const name = args[1];
      const expression = args[2];
      const source = args[3];
      const target = args[4];
      const prompt = args.slice(5).join(' ').trim();

      if (!name || !expression || !prompt) {
        display.errorText(
          'Usage: /automation add-cron <name> <cron> <source|none> <target|-> <prompt...>',
        );
        display.muted(
          'Example: /automation add-cron daily-summary "0 9 * * *" telegram 12345 summarize git status',
        );
        return true;
      }

      try {
        const job = await service.createCronJob({
          name,
          expression,
          prompt,
          target: splitTarget(source, target),
        });
        display.successText(`Created cron job ${job.name} (${job.id})`);
      } catch (error) {
        display.errorText(error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (sub === 'add-webhook') {
      const name = args[1];
      const webhookName = args[2];
      const secretArg = args[3];
      const source = args[4];
      const target = args[5];
      const prompt = args.slice(6).join(' ').trim();
      if (!name || !webhookName || !prompt) {
        display.errorText(
          'Usage: /automation add-webhook <name> <webhook> <secret|none> <source|none> <target|-> <prompt...>',
        );
        return true;
      }
      try {
        const job = await service.createWebhookJob({
          name,
          webhookName,
          secret: secretArg && secretArg !== 'none' && secretArg !== '-' ? secretArg : undefined,
          prompt,
          target: splitTarget(source, target),
        });
        display.successText(`Created webhook job ${job.name} (${job.id})`);
      } catch (error) {
        display.errorText(error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (sub === 'run') {
      const selector = args[1];
      if (!selector) {
        display.errorText('Usage: /automation run <job-id|job-name>');
        return true;
      }
      const job = await service.runNow(selector);
      if (!job) {
        display.errorText(`Job not found: ${selector}`);
      } else {
        display.successText(`Executed job ${job.name}`);
      }
      return true;
    }

    if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      const selector = args[1];
      if (!selector) {
        display.errorText('Usage: /automation remove <job-id|job-name>');
        return true;
      }
      const removed = await service.removeJob(selector);
      if (!removed) {
        display.errorText(`Job not found: ${selector}`);
      } else {
        display.successText(`Removed job ${selector}`);
      }
      return true;
    }

    if (sub === 'enable' || sub === 'disable') {
      const selector = args[1];
      if (!selector) {
        display.errorText(`Usage: /automation ${sub} <job-id|job-name>`);
        return true;
      }
      const updated = await service.setJobEnabled(selector, sub === 'enable');
      if (!updated) {
        display.errorText(`Job not found: ${selector}`);
      } else {
        display.successText(
          `${sub === 'enable' ? 'Enabled' : 'Disabled'} job ${updated.name} (${updated.id})`,
        );
      }
      return true;
    }

    display.renderMarkdown(
      [
        'Automation Commands',
        '',
        '- `/automation list`',
        '- `/automation status`',
        '- `/automation add-cron <name> <cron> <source|none> <target|-> <prompt...>`',
        '- `/automation add-webhook <name> <webhook> <secret|none> <source|none> <target|-> <prompt...>`',
        '- `/automation run <job-id|name>`',
        '- `/automation remove <job-id|name>`',
        '- `/automation enable <job-id|name>`',
        '- `/automation disable <job-id|name>`',
      ].join('\n'),
      true,
    );
    return true;
  },
};

export const automationCommands: CommandHandler[] = [automationCommand];
