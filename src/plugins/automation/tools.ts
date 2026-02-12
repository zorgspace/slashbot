import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getAutomationToolContributions(): ToolContribution[] {
  return [
    {
      name: 'automation_status',
      description: 'Get automation service status and job counters.',
      parameters: z.object({}),
      toAction: () => ({ type: 'automation-status' }),
    },
    {
      name: 'automation_list',
      description: 'List existing automation jobs with trigger and target metadata.',
      parameters: z.object({}),
      toAction: () => ({ type: 'automation-list' }),
    },
    {
      name: 'automation_add_cron',
      description:
        'Create a cron-triggered automation job. Use source=none to avoid connector notifications.',
      parameters: z.object({
        name: z.string().describe('Unique job name'),
        expression: z
          .string()
          .describe('Cron expression such as "0 9 * * *", or aliases like @daily'),
        prompt: z.string().describe('Prompt executed when the job runs'),
        source: z
          .string()
          .optional()
          .describe('Connector source id for notifications, e.g. telegram, discord, or none'),
        targetId: z
          .string()
          .optional()
          .describe('Optional connector target id (chat/channel id) for notifications'),
      }),
      toAction: args => ({
        type: 'automation-add-cron',
        name: args.name as string,
        expression: args.expression as string,
        prompt: args.prompt as string,
        source: args.source as string | undefined,
        targetId: args.targetId as string | undefined,
      }),
    },
    {
      name: 'automation_add_webhook',
      description:
        'Create a webhook-triggered automation job. Use source=none to avoid connector notifications.',
      parameters: z.object({
        name: z.string().describe('Unique job name'),
        webhookName: z
          .string()
          .describe('Webhook trigger name that will be matched by the gateway'),
        prompt: z.string().describe('Prompt executed when the webhook is received'),
        secret: z
          .string()
          .optional()
          .describe('Optional HMAC secret for signature validation'),
        source: z
          .string()
          .optional()
          .describe('Connector source id for notifications, e.g. telegram, discord, or none'),
        targetId: z
          .string()
          .optional()
          .describe('Optional connector target id (chat/channel id) for notifications'),
      }),
      toAction: args => ({
        type: 'automation-add-webhook',
        name: args.name as string,
        webhookName: args.webhookName as string,
        prompt: args.prompt as string,
        secret: args.secret as string | undefined,
        source: args.source as string | undefined,
        targetId: args.targetId as string | undefined,
      }),
    },
    {
      name: 'automation_run',
      description: 'Run a single automation job now using its id or name.',
      parameters: z.object({
        selector: z.string().describe('Job id or job name'),
      }),
      toAction: args => ({
        type: 'automation-run',
        selector: args.selector as string,
      }),
    },
    {
      name: 'automation_remove',
      description: 'Delete an automation job by id or name.',
      parameters: z.object({
        selector: z.string().describe('Job id or job name'),
      }),
      toAction: args => ({
        type: 'automation-remove',
        selector: args.selector as string,
      }),
    },
    {
      name: 'automation_enable',
      description: 'Enable an automation job by id or name.',
      parameters: z.object({
        selector: z.string().describe('Job id or job name'),
      }),
      toAction: args => ({
        type: 'automation-set-enabled',
        selector: args.selector as string,
        enabled: true,
      }),
    },
    {
      name: 'automation_disable',
      description: 'Disable an automation job by id or name.',
      parameters: z.object({
        selector: z.string().describe('Job id or job name'),
      }),
      toAction: args => ({
        type: 'automation-set-enabled',
        selector: args.selector as string,
        enabled: false,
      }),
    },
  ];
}
