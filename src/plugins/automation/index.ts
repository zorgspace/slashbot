/**
 * @module plugins/automation
 *
 * Automation plugin providing a cron scheduler, repeating timers, one-shot delayed
 * jobs, and webhook triggers for automated task execution. Jobs are persisted to
 * `.slashbot/automation.json` and execute prompts through the full LLM + tools
 * agentic pipeline. Webhook endpoints support HMAC-SHA256 signature validation.
 *
 * Tools: automation.list, automation.add_cron, automation.add_webhook,
 *        automation.add_timer, automation.add_once, automation.run,
 *        automation.remove, automation.enable, automation.add_delivery
 *
 * @see {@link createAutomationPlugin} -- Plugin factory function
 * @see {@link parseCronExpression} -- Cron expression parser
 * @see {@link computeNextCronRun} -- Next cron run calculator
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ChannelDefinition, JsonValue, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk/index.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import type { ChannelRegistry, ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { AuthProfileRouter } from '@slashbot/core/providers/auth-router.js';
import type { TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/types.js';
import { KernelLlmAdapter } from '@slashbot/core/agentic/llm/adapter.js';

const CronTriggerSchema = z.object({
  type: z.literal('cron'),
  expression: z.string(),
}).strict();

const WebhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  secret: z.string().optional(),
}).strict();

const TimerTriggerSchema = z.object({
  type: z.literal('timer'),
  intervalMs: z.number(),
}).strict();

const OnceTriggerSchema = z.object({
  type: z.literal('once'),
  runAtMs: z.number(),
}).strict();

const DeliverSchema = z.object({
  channel: z.string(),
  chatId: z.string(),
}).strict();

const AutomationJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  prompt: z.string(),
  trigger: z.discriminatedUnion('type', [CronTriggerSchema, WebhookTriggerSchema, TimerTriggerSchema, OnceTriggerSchema]),
  deliver: DeliverSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  lastStatus: z.enum(['ok', 'error']).optional(),
  lastError: z.string().optional(),
});
import { asObject, asString } from '../utils.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'automation:job:started': { jobId: string; name: string };
    'automation:job:completed': { jobId: string; name: string };
    'automation:job:error': { jobId: string; error: string };
    'automation:webhook:received': { jobId: string; name: string };
  }
}

const PLUGIN_ID = 'slashbot.automation';

// ── Cron parsing ────────────────────────────────────────────────────────

interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = Number(stepStr);
      const start = range === '*' ? min : Number(range);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      for (let i = lo; i <= hi; i++) values.add(i);
    } else {
      values.add(Number(part));
    }
  }
  return values;
}

function parseCronExpression(expr: string): CronSchedule {
  const aliases: Record<string, string> = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
  };
  const normalized = aliases[expr.trim()] ?? expr.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expr}`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function computeNextCronRun(schedule: CronSchedule, from: Date): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const maxIter = 525_600; // ~1 year in minutes
  for (let i = 0; i < maxIter; i++) {
    if (
      schedule.month.has(next.getMonth() + 1) &&
      schedule.dayOfMonth.has(next.getDate()) &&
      schedule.dayOfWeek.has(next.getDay()) &&
      schedule.hour.has(next.getHours()) &&
      schedule.minute.has(next.getMinutes())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  throw new Error('No next cron run found within 1 year');
}

// ── Job types ───────────────────────────────────────────────────────────

interface CronTrigger {
  type: 'cron';
  expression: string;
}

interface WebhookTrigger {
  type: 'webhook';
  secret?: string;
}

interface TimerTrigger {
  type: 'timer';
  intervalMs: number;
}

interface OnceTrigger {
  type: 'once';
  runAtMs: number;
}

interface DeliverConfig {
  channel: string;
  chatId: string;
}

interface AutomationJob {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  trigger: CronTrigger | WebhookTrigger | TimerTrigger | OnceTrigger;
  deliver?: DeliverConfig;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

// ── AutomationService ───────────────────────────────────────────────────

/**
 * AutomationService — manages persistent cron and webhook automation jobs.
 *
 * Stores jobs in `.slashbot/automation.json`. Cron jobs are scheduled via
 * setTimeout chains; webhook jobs are triggered by incoming HTTP requests
 * with optional HMAC-SHA256 signature validation.
 */
type AgentRunner = (prompt: string, sessionId: string) => Promise<{ text: string; toolCalls: number }>;

class AutomationService {
  private jobs: AutomationJob[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly filePath: string;
  private readonly runningJobs = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly events: EventBus | undefined,
    private readonly runTool?: (toolId: string, args: JsonValue, ctx: Record<string, unknown>) => Promise<{ ok: boolean; output?: JsonValue }>,
    private readonly runAgent?: AgentRunner,
    private readonly getChannel?: (channelId: string) => ChannelDefinition | undefined,
  ) {
    this.filePath = join(workspaceRoot, '.slashbot', 'automation.json');
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const result = z.array(AutomationJobSchema).safeParse(JSON.parse(data));
      this.jobs = result.success ? (result.data as AutomationJob[]) : [];
    } catch {
      this.jobs = [];
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(join(this.workspaceRoot, '.slashbot'), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.jobs, null, 2), 'utf8');
  }

  list(): AutomationJob[] {
    return [...this.jobs];
  }

  async addCronJob(name: string, expression: string, prompt: string, deliver?: DeliverConfig): Promise<AutomationJob> {
    parseCronExpression(expression); // validate
    const job: AutomationJob = {
      id: randomUUID(),
      name,
      enabled: true,
      prompt,
      trigger: { type: 'cron', expression },
      ...(deliver ? { deliver } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    this.scheduleCron(job);
    return job;
  }

  async addWebhookJob(name: string, prompt: string, secret?: string): Promise<AutomationJob> {
    const job: AutomationJob = {
      id: randomUUID(),
      name,
      enabled: true,
      prompt,
      trigger: { type: 'webhook', secret },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    return job;
  }

  async addTimerJob(name: string, intervalMs: number, prompt: string, deliver?: DeliverConfig): Promise<AutomationJob> {
    if (intervalMs < 1000) throw new Error('Interval must be at least 1000ms');
    const job: AutomationJob = {
      id: randomUUID(),
      name,
      enabled: true,
      prompt,
      trigger: { type: 'timer', intervalMs },
      ...(deliver ? { deliver } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    this.scheduleTimer(job);
    return job;
  }

  async addOnceJob(name: string, runAtMs: number, prompt: string, deliver?: DeliverConfig): Promise<AutomationJob> {
    const job: AutomationJob = {
      id: randomUUID(),
      name,
      enabled: true,
      prompt,
      trigger: { type: 'once', runAtMs },
      ...(deliver ? { deliver } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    this.scheduleOnce(job);
    return job;
  }

  async setDelivery(idOrName: string, deliver: DeliverConfig | undefined): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === idOrName || j.name === idOrName);
    if (!job) return false;
    job.deliver = deliver;
    job.updatedAt = new Date().toISOString();
    await this.save();
    return true;
  }

  async removeJob(idOrName: string): Promise<boolean> {
    const idx = this.jobs.findIndex((j) => j.id === idOrName || j.name === idOrName);
    if (idx === -1) return false;
    const job = this.jobs[idx];
    this.clearTimer(job.id);
    this.jobs.splice(idx, 1);
    await this.save();
    return true;
  }

  async setEnabled(idOrName: string, enabled: boolean): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === idOrName || j.name === idOrName);
    if (!job) return false;
    job.enabled = enabled;
    job.updatedAt = new Date().toISOString();
    if (enabled) {
      if (job.trigger.type === 'cron') this.scheduleCron(job);
      else if (job.trigger.type === 'timer') this.scheduleTimer(job);
      else if (job.trigger.type === 'once') this.scheduleOnce(job);
    } else {
      this.clearTimer(job.id);
    }
    await this.save();
    return true;
  }

  async runJob(idOrName: string): Promise<{ ok: boolean; result?: string; error?: string }> {
    const job = this.jobs.find((j) => j.id === idOrName || j.name === idOrName);
    if (!job) return { ok: false, error: 'Job not found' };
    if (this.runningJobs.has(job.id)) return { ok: false, error: 'Job already running' };

    this.runningJobs.add(job.id);
    this.events?.publish('automation:job:started', { jobId: job.id, name: job.name });

    let result: string | undefined;
    try {
      if (this.runAgent) {
        // Prefer agentic loop — runs the prompt through the full LLM + tools pipeline
        const sessionId = `automation-${job.id}`;
        const agentResult = await this.runAgent(job.prompt, sessionId);
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
        result = agentResult.text;
      } else if (this.runTool) {
        // Fallback: execute via kernel tool runner
        const toolResult = await this.runTool('shell.exec', { command: 'bash', args: ['-lc', `echo "${job.prompt}"`] }, {});
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = toolResult.ok ? 'ok' : 'error';
        if (!toolResult.ok) job.lastError = String(toolResult.output ?? 'Unknown error');
        result = typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output);
      } else {
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
      }

      await this.save();
      this.events?.publish('automation:job:completed', { jobId: job.id, name: job.name });

      // Deliver result to channel if configured
      if (job.deliver && result && this.getChannel) {
        const channel = this.getChannel(job.deliver.channel);
        if (channel) {
          try {
            await channel.send({ chatId: job.deliver.chatId, content: result } as unknown as JsonValue);
          } catch {
            // delivery failure is non-fatal
          }
        }
      }

      return { ok: true, result: result ?? `Job ${job.name} executed` };
    } catch (err) {
      job.lastRunAt = new Date().toISOString();
      job.lastStatus = 'error';
      job.lastError = String(err);
      await this.save();
      this.events?.publish('automation:job:error', { jobId: job.id, error: String(err) });
      return { ok: false, error: String(err) };
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  async handleWebhook(name: string, headers: Record<string, string>, body: string): Promise<{ ok: boolean; error?: string }> {
    const job = this.jobs.find((j) => j.name === name && j.trigger.type === 'webhook');
    if (!job || !job.enabled) return { ok: false, error: 'Webhook job not found or disabled' };

    const trigger = job.trigger as WebhookTrigger;
    if (trigger.secret) {
      const signature = headers['x-slashbot-signature'] ?? headers['x-signature'] ?? headers['x-hub-signature-256'] ?? '';
      const expected = `sha256=${createHmac('sha256', trigger.secret).update(body).digest('hex')}`;
      try {
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return { ok: false, error: 'Invalid webhook signature' };
        }
      } catch {
        return { ok: false, error: 'Invalid webhook signature' };
      }
    }

    this.events?.publish('automation:webhook:received', { jobId: job.id, name: job.name });
    return this.runJob(job.id);
  }

  resumeTimers(): void {
    for (const job of this.jobs) {
      if (!job.enabled) continue;
      if (job.trigger.type === 'cron') {
        this.scheduleCron(job);
      } else if (job.trigger.type === 'timer') {
        this.scheduleTimer(job);
      } else if (job.trigger.type === 'once') {
        this.scheduleOnce(job);
      }
    }
  }

  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private scheduleCron(job: AutomationJob): void {
    if (job.trigger.type !== 'cron') return;
    this.clearTimer(job.id);
    try {
      const schedule = parseCronExpression(job.trigger.expression);
      const nextRun = computeNextCronRun(schedule, new Date());
      const delay = nextRun.getTime() - Date.now();
      this.timers.set(
        job.id,
        setTimeout(() => {
          void this.runJob(job.id).then(() => {
            if (job.enabled) this.scheduleCron(job);
          });
        }, Math.max(delay, 1000)),
      );
    } catch {
      // Invalid cron, skip
    }
  }

  private scheduleTimer(job: AutomationJob): void {
    if (job.trigger.type !== 'timer') return;
    this.clearTimer(job.id);
    const intervalMs = job.trigger.intervalMs;
    const tick = () => {
      void this.runJob(job.id).then(() => {
        if (job.enabled) {
          this.timers.set(job.id, setTimeout(tick, intervalMs));
        }
      });
    };
    this.timers.set(job.id, setTimeout(tick, intervalMs));
  }

  private scheduleOnce(job: AutomationJob): void {
    if (job.trigger.type !== 'once') return;
    this.clearTimer(job.id);
    const delay = Math.max(0, job.trigger.runAtMs - Date.now());
    this.timers.set(
      job.id,
      setTimeout(() => {
        void this.runJob(job.id).then(() => {
          void this.removeJob(job.id);
        });
      }, delay),
    );
  }

  private clearTimer(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
  }
}

// ── Plugin factory ──────────────────────────────────────────────────────

/**
 * Create the Automation plugin.
 *
 * Manages persistent automation jobs that execute on cron schedules, repeating
 * timers, one-shot delays, or incoming webhook requests. Supports HMAC-SHA256
 * signature validation for webhooks.
 *
 * Dependencies: providers.auth
 *
 * Tools:
 *  - `automation.list`         -- List all automation jobs.
 *  - `automation.add_cron`     -- Add a cron-triggered job.
 *  - `automation.add_webhook`  -- Add a webhook-triggered job.
 *  - `automation.add_timer`    -- Add a repeating timer job.
 *  - `automation.add_once`     -- Add a one-shot delayed job.
 *  - `automation.run`          -- Run a job immediately by ID or name.
 *  - `automation.remove`       -- Remove a job by ID or name.
 *  - `automation.enable`       -- Enable or disable a job.
 *  - `automation.add_delivery` -- Set or remove channel delivery on a job.
 *
 * HTTP routes:
 *  - `POST /automation/webhook/:name` -- Webhook trigger endpoint.
 *
 * Services:
 *  - `automation.service` -- AutomationService instance for programmatic job management.
 *
 * Hooks:
 *  - `automation.startup`  -- Load persisted jobs and resume timers.
 *  - `automation.shutdown` -- Stop all running timers.
 *
 * @returns A SlashbotPlugin instance with automation tools, routes, services, and lifecycle hooks.
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
      const events = context.getService<EventBus>('kernel.events');
      const runTool = context.getService<(toolId: string, args: JsonValue, ctx: Record<string, unknown>) => Promise<{ ok: boolean; output?: JsonValue }>>('kernel.runTool');

      // Wire agentic runner so automation jobs run through the full LLM + tools pipeline
      let runAgent: AgentRunner | undefined;
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger');
      const assemblePrompt = context.getService<() => Promise<string>>('kernel.assemblePrompt');

      if (kernel && authRouter && providers && logger && assemblePrompt) {
        const llm = new KernelLlmAdapter(
          authRouter, providers, logger, kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );

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
      service = new AutomationService(workspaceRoot, events, runTool, runAgent, (id) => channels?.get(id));

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
 *
 * - {@link parseCronExpression} -- Parse a 5-field cron expression (or alias) into a CronSchedule.
 * - {@link parseField} -- Parse a single cron field into a set of matching values.
 * - {@link computeNextCronRun} -- Compute the next matching Date from a CronSchedule.
 */
export { parseCronExpression, parseField, computeNextCronRun };
