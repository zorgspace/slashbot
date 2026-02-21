/**
 * @module plugins/automation
 *
 * Automation plugin providing a cron scheduler, repeating timers, one-shot delayed
 * jobs, and webhook triggers for automated task execution.
 */
import { z } from 'zod';
import type { JsonValue, SlashbotPlugin } from '../../plugin-sdk/index.js';
import type { ChannelRegistry } from '@slashbot/core/kernel/registries.js';
import { asObject, asString, createLlmAdapter, resolveCommonServices } from '../utils.js';
import { computeNextCronRun, parseCronExpression, parseField } from './cron.js';
import { AutomationService } from './automation-service.js';
import type { AgentRunner } from './types.js';

export { AutomationService } from './automation-service.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'automation:job:started': { jobId: string; name: string };
    'automation:job:completed': { jobId: string; name: string };
    'automation:job:error': { jobId: string; error: string };
    'automation:webhook:received': { jobId: string; name: string };
  }
}

const PLUGIN_ID = 'slashbot.automation';

/**
 * Create the Automation plugin.
 */
export function createAutomationPlugin(): SlashbotPlugin {
  let service: AutomationService;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Automation',
      version: '0.1.0',
      main: 'bundled',
      description: 'Cron scheduler and webhook triggers for automated tasks',
      dependencies: ['slashbot.providers.auth'],
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const { events, logger } = resolveCommonServices(context);
      const runTool = context.getService<(toolId: string, args: JsonValue, ctx: Record<string, unknown>) => Promise<{ ok: boolean; output?: JsonValue }>>('kernel.runTool');

      // Wire agentic runner so automation jobs run through the full LLM + tools pipeline
      let runAgent: AgentRunner | undefined;
      const llm = createLlmAdapter(context);
      const assemblePrompt = context.getService<() => Promise<string>>('kernel.assemblePrompt');

      if (llm && assemblePrompt) {
        runAgent = async (prompt, sessionId) => {
          const systemPrompt = await assemblePrompt();
          const result = await llm.complete({
            sessionId,
            agentId: 'automation',
            messages: [
              { role: 'system', content: `${systemPrompt}\n\nYou are executing an automation job. Complete the task using available tools. Be concise.` },
              { role: 'user', content: prompt },
            ],
          });
          return { text: result.text, toolCalls: result.toolCalls };
        };
      }

      const channels = context.getService<ChannelRegistry>('kernel.channels.registry');
      service = new AutomationService(workspaceRoot, events, runTool, runAgent, (id) => channels?.get(id), context.logger);

      context.registerService({
        id: 'automation.service',
        pluginId: PLUGIN_ID,
        description: 'Automation cron/webhook job service',
        implementation: service,
      });

      context.registerTool({
        id: 'automation.list',
        title: 'List automations',
        pluginId: PLUGIN_ID,
        description: 'List all automation jobs (cron, timer, once, webhook)',
        parameters: z.object({}),
        execute: async () => {
          const jobs = service.list();
          return { ok: true, output: jobs as unknown as JsonValue };
        },
      });

      context.registerTool({
        id: 'automation.add_cron',
        title: 'Schedule cron job',
        pluginId: PLUGIN_ID,
        description: 'Schedule a recurring job using a cron expression (e.g. "*/5 * * * *" for every 5 min, or @hourly/@daily/@weekly/@monthly)',
        parameters: z.object({
          name: z.string().describe('Short name for this job'),
          expression: z.string().describe('Cron expression (5-field) or alias like @hourly, @daily'),
          prompt: z.string().describe('The prompt to execute when the job fires'),
          deliverChannel: z.string().optional().describe('Channel to deliver result to (e.g. "telegram")'),
          deliverChatId: z.string().optional().describe('Chat ID for delivery'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const name = asString(input.name, 'name');
            const expression = asString(input.expression, 'expression');
            const prompt = asString(input.prompt, 'prompt');
            const deliver = typeof input.deliverChannel === 'string' && typeof input.deliverChatId === 'string'
              ? { channel: input.deliverChannel as string, chatId: input.deliverChatId as string }
              : undefined;
            const job = await service.addCronJob(name, expression, prompt, deliver);
            return { ok: true, output: job as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'AUTOMATION_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.add_webhook',
        title: 'Add webhook job',
        pluginId: PLUGIN_ID,
        description: 'Add a job triggered by an incoming HTTP POST to /automation/webhook/:name',
        parameters: z.object({
          name: z.string().describe('Webhook name (used in the URL path)'),
          prompt: z.string().describe('The prompt to execute when the webhook fires'),
          secret: z.string().optional().describe('HMAC-SHA256 secret for signature validation'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const name = asString(input.name, 'name');
            const prompt = asString(input.prompt, 'prompt');
            const secret = typeof input.secret === 'string' ? input.secret : undefined;
            const job = await service.addWebhookJob(name, prompt, secret);
            return { ok: true, output: job as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'AUTOMATION_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.add_timer',
        title: 'Schedule repeating timer',
        pluginId: PLUGIN_ID,
        description: 'Schedule a job that repeats at a fixed interval (e.g. every 60s, every 300s)',
        parameters: z.object({
          name: z.string().describe('Short name for this job'),
          intervalSeconds: z.number().describe('Repeat interval in seconds (minimum 1)'),
          prompt: z.string().describe('The prompt to execute each time the timer fires'),
          deliverChannel: z.string().optional().describe('Channel to deliver result to (e.g. "telegram")'),
          deliverChatId: z.string().optional().describe('Chat ID for delivery'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const name = asString(input.name, 'name');
            const intervalSeconds = typeof input.intervalSeconds === 'number' ? input.intervalSeconds : undefined;
            if (!intervalSeconds || intervalSeconds < 1) {
              return { ok: false, error: { code: 'AUTOMATION_ERROR', message: 'intervalSeconds must be >= 1' } };
            }
            const prompt = asString(input.prompt, 'prompt');
            const deliver = typeof input.deliverChannel === 'string' && typeof input.deliverChatId === 'string'
              ? { channel: input.deliverChannel as string, chatId: input.deliverChatId as string }
              : undefined;
            const job = await service.addTimerJob(name, intervalSeconds * 1000, prompt, deliver);
            return { ok: true, output: job as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'AUTOMATION_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.add_once',
        title: 'Schedule one-shot',
        pluginId: PLUGIN_ID,
        description: 'Schedule a one-shot job that fires once after a delay then auto-removes. Use for reminders, alarms, and deferred tasks.',
        parameters: z.object({
          name: z.string().describe('Short name for this job (e.g. "5min-alarm")'),
          delaySeconds: z.number().describe('Seconds from now until the job fires'),
          prompt: z.string().describe('The prompt to execute when the delay expires'),
          deliverChannel: z.string().optional().describe('Channel to deliver result to (e.g. "telegram")'),
          deliverChatId: z.string().optional().describe('Chat ID for delivery'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const name = asString(input.name, 'name');
            const delaySeconds = typeof input.delaySeconds === 'number' ? input.delaySeconds : undefined;
            if (!delaySeconds || delaySeconds < 1) {
              return { ok: false, error: { code: 'AUTOMATION_ERROR', message: 'delaySeconds must be >= 1' } };
            }
            const prompt = asString(input.prompt, 'prompt');
            const deliver = typeof input.deliverChannel === 'string' && typeof input.deliverChatId === 'string'
              ? { channel: input.deliverChannel as string, chatId: input.deliverChatId as string }
              : undefined;
            const runAtMs = Date.now() + delaySeconds * 1000;
            const job = await service.addOnceJob(name, runAtMs, prompt, deliver);
            return { ok: true, output: job as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'AUTOMATION_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.run',
        title: 'Run job now',
        pluginId: PLUGIN_ID,
        description: 'Run an existing automation job immediately by ID or name',
        parameters: z.object({
          id: z.string().describe('Job ID or name'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const id = asString(input.id, 'id');
            const result = await service.runJob(id);
            return result.ok
              ? { ok: true, output: result.result ?? 'done' }
              : { ok: false, error: { code: 'RUN_ERROR', message: result.error ?? 'unknown' } };
          } catch (err) {
            return { ok: false, error: { code: 'RUN_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.remove',
        title: 'Remove job',
        pluginId: PLUGIN_ID,
        description: 'Remove an automation job by ID or name',
        parameters: z.object({
          id: z.string().describe('Job ID or name'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const id = asString(input.id, 'id');
            const removed = await service.removeJob(id);
            return removed
              ? { ok: true, output: 'removed' }
              : { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } };
          } catch (err) {
            return { ok: false, error: { code: 'REMOVE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.enable',
        title: 'Toggle job',
        pluginId: PLUGIN_ID,
        description: 'Enable or disable an automation job',
        parameters: z.object({
          id: z.string().describe('Job ID or name'),
          enabled: z.boolean().describe('true to enable, false to disable'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const id = asString(input.id, 'id');
            const enabled = input.enabled === true;
            const updated = await service.setEnabled(id, enabled);
            return updated
              ? { ok: true, output: `Job ${enabled ? 'enabled' : 'disabled'}` }
              : { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } };
          } catch (err) {
            return { ok: false, error: { code: 'ENABLE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'automation.add_delivery',
        title: 'Set delivery',
        pluginId: PLUGIN_ID,
        description: 'Set or remove channel delivery on an existing automation job',
        parameters: z.object({
          id: z.string().describe('Job ID or name'),
          channel: z.string().optional().describe('Channel ID (e.g. "telegram"). Omit both to remove delivery.'),
          chatId: z.string().optional().describe('Chat ID for delivery'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const id = asString(input.id, 'id');
            const channel = typeof input.channel === 'string' ? input.channel : undefined;
            const chatId = typeof input.chatId === 'string' ? input.chatId : undefined;
            const deliver = channel && chatId ? { channel, chatId } : undefined;
            const updated = await service.setDelivery(id, deliver);
            return updated
              ? { ok: true, output: deliver ? `Delivery set to ${channel}:${chatId}` : 'Delivery removed' }
              : { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } };
          } catch (err) {
            return { ok: false, error: { code: 'DELIVERY_ERROR', message: String(err) } };
          }
        },
      });

      context.registerHttpRoute({
        method: 'POST',
        path: '/automation/webhook/:name',
        pluginId: PLUGIN_ID,
        description: 'Webhook trigger endpoint for automation jobs',
        handler: async (req, res) => {
          const urlParts = (req.url ?? '').split('/');
          const name = urlParts[urlParts.length - 1] ?? '';

          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
          }

          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers[key] = value;
          }

          const result = await service.handleWebhook(name, headers, body);

          res.statusCode = result.ok ? 200 : 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(result));
        },
      });

      // Startup hook: load jobs and resume timers
      context.registerHook({
        id: 'automation.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 50,
        handler: async () => {
          await service.load();
          service.resumeTimers();
          context.logger.info('Automation service started', { jobs: service.list().length });
        },
      });

      // Shutdown hook: stop all timers
      context.registerHook({
        id: 'automation.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 50,
        handler: () => {
          service.stopAll();
          context.logger.info('Automation service stopped');
        },
      });
    },
  };
}

/** Alias for {@link createAutomationPlugin} conforming to the bundled plugin loader convention. */
export { createAutomationPlugin as createPlugin };

/**
 * Re-exported cron utilities for use by other modules and tests.
 */
export { parseCronExpression, parseField, computeNextCronRun };
