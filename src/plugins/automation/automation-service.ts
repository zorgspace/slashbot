import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ChannelDefinition, JsonValue, StructuredLogger } from '../../plugin-sdk/index.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import { computeNextCronRun, parseCronExpression } from './cron.js';
import type { AgentRunner, AutomationJob, DeliverConfig, WebhookTrigger } from './types.js';
import { AutomationJobSchema } from './types.js';

/**
 * AutomationService — manages persistent cron and webhook automation jobs.
 *
 * Stores jobs in `.slashbot/automation.json`. Cron jobs are scheduled via
 * setTimeout chains; webhook jobs are triggered by incoming HTTP requests
 * with optional HMAC-SHA256 signature validation.
 */
export class AutomationService {
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
    private readonly logger?: StructuredLogger,
  ) {
    this.filePath = join(workspaceRoot, '.slashbot', 'automation.json');
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (error) {
        await this.handleCorruptStore(`Invalid automation JSON: ${this.errorMessage(error)}`);
        return;
      }

      const result = z.array(AutomationJobSchema).safeParse(parsed);
      if (!result.success) {
        const reason = result.error.issues.slice(0, 3).map((issue) => issue.message).join('; ');
        await this.handleCorruptStore(`Invalid automation schema: ${reason}`);
        return;
      }
      this.jobs = result.data as AutomationJob[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Failed to load automation jobs', {
          path: this.filePath,
          reason: this.errorMessage(error),
        });
      }
      this.jobs = [];
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(join(this.workspaceRoot, '.slashbot'), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.jobs, null, 2), 'utf8');
    } catch (error) {
      this.logger?.error('Failed to persist automation jobs', {
        path: this.filePath,
        reason: this.errorMessage(error),
      });
      throw error;
    }
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
        const sessionId = `automation-${job.id}`;
        const agentResult = await this.runAgent(job.prompt, sessionId);
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
        result = agentResult.text;
      } else if (this.runTool) {
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
        result = job.prompt;
      } else {
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
      }

      await this.save();
      this.events?.publish('automation:job:completed', { jobId: job.id, name: job.name });

      if (job.deliver && result && this.getChannel) {
        const channel = this.getChannel(job.deliver.channel);
        if (channel) {
          try {
            await channel.send({ chatId: job.deliver.chatId, content: result } as unknown as JsonValue);
          } catch (error) {
            this.logger?.warn('Automation delivery failed', {
              jobId: job.id,
              channel: job.deliver.channel,
              chatId: job.deliver.chatId,
              reason: this.errorMessage(error),
            });
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
    } catch (error) {
      const reason = this.errorMessage(error);
      job.lastStatus = 'error';
      job.lastError = reason;
      job.updatedAt = new Date().toISOString();
      this.logger?.warn('Failed to schedule automation cron job', {
        jobId: job.id,
        name: job.name,
        expression: job.trigger.expression,
        reason,
      });
      this.events?.publish('automation:job:error', { jobId: job.id, error: reason });
      void this.save().catch(() => {});
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async handleCorruptStore(reason: string): Promise<void> {
    this.jobs = [];
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(this.filePath, backupPath);
      this.logger?.warn('Automation jobs file was corrupt and has been moved aside', {
        path: this.filePath,
        backupPath,
        reason,
      });
    } catch (renameError) {
      this.logger?.warn('Automation jobs file is corrupt', {
        path: this.filePath,
        reason: `${reason}; backup failed: ${this.errorMessage(renameError)}`,
      });
    }
  }
}
