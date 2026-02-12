import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import type { ConnectorRegistry } from '../../../connectors/registry';
import type { EventBus } from '../../../core/events/EventBus';
import { getLocalAutomationJobsFile } from '../../../core/config/constants';
import type { GatewayWebhookPayload } from '../../../core/gateway/protocol';
import type { AutomationJob, AutomationJobTrigger, AutomationRunContext, AutomationSummary } from '../types';

const TICK_INTERVAL_MS = 15_000;

interface PersistedAutomationJobs {
  version: 1;
  jobs: AutomationJob[];
}

interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

type GrokClientLike = {
  chat: (
    userMessage: string,
    options?: {
      sessionId?: string;
      displayResult?: boolean;
      quiet?: boolean;
      outputTabId?: string;
      onOutputChunk?: (chunk: string) => void;
    },
  ) => Promise<{ response: string; thinking: string }>;
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, '-').toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function coerceBool(value: unknown, defaultValue = true): boolean {
  if (typeof value === 'boolean') return value;
  return defaultValue;
}

function parseNumericValue(value: string, min: number, max: number): number | null {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function rangeSet(min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (let i = min; i <= max; i++) {
    result.add(i);
  }
  return result;
}

function parseCronSegment(segment: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();
  const chunks = segment.split(',');

  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (!chunk) return null;

    const [basePart, stepPart] = chunk.split('/');
    const step =
      stepPart === undefined
        ? 1
        : (() => {
            const parsed = Number(stepPart);
            if (!Number.isInteger(parsed) || parsed <= 0) return null;
            return parsed;
          })();
    if (!step) return null;

    const baseSet = (() => {
      if (basePart === '*') {
        return rangeSet(min, max);
      }
      if (basePart.includes('-')) {
        const [startRaw, endRaw] = basePart.split('-');
        const start = parseNumericValue(startRaw, min, max);
        const end = parseNumericValue(endRaw, min, max);
        if (start === null || end === null || start > end) return null;
        return rangeSet(start, end);
      }
      const value = parseNumericValue(basePart, min, max);
      if (value === null) return null;
      return new Set<number>([value]);
    })();
    if (!baseSet) return null;

    const ordered = [...baseSet].sort((a, b) => a - b);
    for (let idx = 0; idx < ordered.length; idx += step) {
      result.add(ordered[idx]);
    }
  }

  if (result.size === 0) return null;
  return result;
}

function parseCronExpression(expression: string): CronSchedule | null {
  const normalized = expression.trim();
  const aliasMap: Record<string, string> = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
  };
  const expanded = aliasMap[normalized.toLowerCase()] || normalized;
  const parts = expanded.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return null;

  const minute = parseCronSegment(parts[0], 0, 59);
  const hour = parseCronSegment(parts[1], 0, 23);
  const dayOfMonth = parseCronSegment(parts[2], 1, 31);
  const month = parseCronSegment(parts[3], 1, 12);
  const dayOfWeekRaw = parseCronSegment(parts[4], 0, 7);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeekRaw) return null;
  const dayOfWeek = new Set<number>();
  for (const value of dayOfWeekRaw) {
    dayOfWeek.add(value === 7 ? 0 : value);
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function matchesCron(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minute.has(date.getMinutes()) &&
    schedule.hour.has(date.getHours()) &&
    schedule.dayOfMonth.has(date.getDate()) &&
    schedule.month.has(date.getMonth() + 1) &&
    schedule.dayOfWeek.has(date.getDay())
  );
}

function computeNextCronRun(expression: string, from: Date = new Date()): Date | null {
  const schedule = parseCronExpression(expression);
  if (!schedule) return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 525_600; // ~1 year in minutes.
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(schedule, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function constantTimeEquals(left: string, right: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
  } catch {
    return false;
  }
}

function hmacSignature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function extractSignature(headers: Record<string, string>): string | null {
  const value = headers['x-slashbot-signature'] || headers['x-signature'] || headers['x-hub-signature-256'];
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.startsWith('sha256=')) {
    return normalized.slice('sha256='.length);
  }
  return normalized;
}

export class AutomationService {
  private readonly eventBus: EventBus;
  private readonly connectorRegistry: ConnectorRegistry;
  private readonly jobsFile: string;
  private jobs: AutomationJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private loaded = false;
  private readonly runningJobs = new Set<string>();
  private getGrokClient: (() => GrokClientLike | null) | null = null;

  constructor(options: {
    eventBus: EventBus;
    connectorRegistry: ConnectorRegistry;
    workDir?: string;
    jobsFile?: string;
  }) {
    this.eventBus = options.eventBus;
    this.connectorRegistry = options.connectorRegistry;
    this.jobsFile = options.jobsFile || getLocalAutomationJobsFile(options.workDir);
  }

  setGrokClientResolver(resolver: (() => GrokClientLike | null) | null): void {
    this.getGrokClient = resolver;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await this.loadJobs();
  }

  private async saveJobs(): Promise<void> {
    await mkdir(path.dirname(this.jobsFile), { recursive: true });
    const payload: PersistedAutomationJobs = {
      version: 1,
      jobs: this.jobs,
    };
    await writeFile(this.jobsFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  private normalizeLoadedJobs(rawJobs: unknown): AutomationJob[] {
    if (!Array.isArray(rawJobs)) return [];
    const normalized: AutomationJob[] = [];
    for (const raw of rawJobs) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Partial<AutomationJob>;
      if (!item.id || !item.name || !item.prompt || !item.trigger) continue;
      const base: AutomationJob = {
        id: String(item.id),
        name: String(item.name),
        enabled: coerceBool(item.enabled, true),
        prompt: String(item.prompt),
        trigger: item.trigger as AutomationJobTrigger,
        target: item.target,
        createdAt: String(item.createdAt || nowIso()),
        updatedAt: String(item.updatedAt || nowIso()),
        lastRunAt: item.lastRunAt,
        lastStatus: item.lastStatus,
        lastError: item.lastError,
      };
      normalized.push(base);
    }
    return normalized;
  }

  private refreshCronSchedules(reference: Date = new Date()): void {
    for (const job of this.jobs) {
      if (job.trigger.type !== 'cron') continue;
      const next = computeNextCronRun(job.trigger.expression, reference);
      job.trigger.nextRunAt = next ? next.toISOString() : undefined;
    }
  }

  private async loadJobs(): Promise<void> {
    try {
      const rawText = await readFile(this.jobsFile, 'utf8');
      const raw = JSON.parse(rawText) as Partial<PersistedAutomationJobs>;
      this.jobs = this.normalizeLoadedJobs(raw?.jobs);
      this.refreshCronSchedules();
      await this.saveJobs();
    } catch {
      this.jobs = [];
    }
  }

  getSummary(): AutomationSummary {
    const total = this.jobs.length;
    const enabled = this.jobs.filter(job => job.enabled).length;
    const cron = this.jobs.filter(job => job.trigger.type === 'cron').length;
    const webhook = this.jobs.filter(job => job.trigger.type === 'webhook').length;
    return {
      running: this.running,
      total,
      enabled,
      cron,
      webhook,
    };
  }

  listJobs(): AutomationJob[] {
    return [...this.jobs].sort((a, b) => a.name.localeCompare(b.name));
  }

  private findJob(selector: string): AutomationJob | null {
    const normalized = selector.trim().toLowerCase();
    if (!normalized) return null;
    return (
      this.jobs.find(job => job.id.toLowerCase() === normalized) ||
      this.jobs.find(job => normalizeName(job.name) === normalizeName(normalized)) ||
      null
    );
  }

  async createCronJob(options: {
    name: string;
    expression: string;
    prompt: string;
    target?: { source: string; targetId?: string };
  }): Promise<AutomationJob> {
    const expression = options.expression.trim();
    if (!parseCronExpression(expression)) {
      throw new Error('Invalid cron expression');
    }
    if (!options.prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }
    if (this.jobs.some(job => normalizeName(job.name) === normalizeName(options.name))) {
      throw new Error(`Job already exists: ${options.name}`);
    }

    const createdAt = nowIso();
    const job: AutomationJob = {
      id: randomId('auto'),
      name: options.name.trim(),
      enabled: true,
      prompt: options.prompt.trim(),
      trigger: {
        type: 'cron',
        expression,
      },
      target: options.target,
      createdAt,
      updatedAt: createdAt,
    };
    this.jobs.push(job);
    this.refreshCronSchedules();
    await this.saveJobs();
    return job;
  }

  async createWebhookJob(options: {
    name: string;
    webhookName: string;
    secret?: string;
    prompt: string;
    target?: { source: string; targetId?: string };
  }): Promise<AutomationJob> {
    const webhookName = options.webhookName.trim().toLowerCase();
    if (!webhookName) {
      throw new Error('Webhook name cannot be empty');
    }
    if (!options.prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }
    if (this.jobs.some(job => normalizeName(job.name) === normalizeName(options.name))) {
      throw new Error(`Job already exists: ${options.name}`);
    }
    const createdAt = nowIso();
    const job: AutomationJob = {
      id: randomId('auto'),
      name: options.name.trim(),
      enabled: true,
      prompt: options.prompt.trim(),
      trigger: {
        type: 'webhook',
        name: webhookName,
        secret: options.secret?.trim() || undefined,
      },
      target: options.target,
      createdAt,
      updatedAt: createdAt,
    };
    this.jobs.push(job);
    await this.saveJobs();
    return job;
  }

  async removeJob(selector: string): Promise<boolean> {
    const found = this.findJob(selector);
    if (!found) return false;
    this.jobs = this.jobs.filter(job => job.id !== found.id);
    await this.saveJobs();
    return true;
  }

  async setJobEnabled(selector: string, enabled: boolean): Promise<AutomationJob | null> {
    const found = this.findJob(selector);
    if (!found) return null;
    found.enabled = enabled;
    found.updatedAt = nowIso();
    this.refreshCronSchedules();
    await this.saveJobs();
    return found;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runJob(job: AutomationJob, context: AutomationRunContext): Promise<void> {
    if (this.runningJobs.has(job.id)) {
      return;
    }
    this.runningJobs.add(job.id);
    this.eventBus.emit({
      type: 'automation:job:started',
      jobId: job.id,
      name: job.name,
      reason: context.reason,
    });

    try {
      const resolver = this.getGrokClient;
      if (!resolver) {
        throw new Error('Grok client resolver is not set');
      }
      const client = resolver();
      if (!client) {
        throw new Error('Grok client is not available');
      }

      let prompt = job.prompt;
      if (context.webhook) {
        const payloadPreview =
          typeof context.webhook.payload === 'string'
            ? context.webhook.payload
            : JSON.stringify(context.webhook.payload, null, 2);
        prompt = [
          job.prompt,
          '',
          '[Webhook Trigger]',
          `Name: ${context.webhook.name}`,
          'Payload:',
          payloadPreview || '(empty)',
        ].join('\n');
      }

      const outcome = await client.chat(prompt, {
        sessionId: `automation:${job.id}`,
        displayResult: false,
        quiet: true,
      });
      const response = outcome.response?.trim() || 'Done.';

      if (job.target?.source) {
        await this.connectorRegistry.notify(response, job.target.source, job.target.targetId);
      }

      job.lastRunAt = nowIso();
      job.lastStatus = 'ok';
      job.lastError = undefined;
      job.updatedAt = nowIso();
      if (job.trigger.type === 'cron') {
        const next = computeNextCronRun(job.trigger.expression, new Date());
        job.trigger.nextRunAt = next ? next.toISOString() : undefined;
      }
      await this.saveJobs();

      this.eventBus.emit({
        type: 'automation:job:completed',
        jobId: job.id,
        name: job.name,
        reason: context.reason,
      });
    } catch (error) {
      job.lastRunAt = nowIso();
      job.lastStatus = 'error';
      job.lastError = error instanceof Error ? error.message : String(error);
      job.updatedAt = nowIso();
      if (job.trigger.type === 'cron') {
        const next = computeNextCronRun(job.trigger.expression, new Date());
        job.trigger.nextRunAt = next ? next.toISOString() : undefined;
      }
      await this.saveJobs();
      this.eventBus.emit({
        type: 'automation:job:error',
        jobId: job.id,
        name: job.name,
        reason: context.reason,
        error: job.lastError,
      });
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  async runNow(selector: string): Promise<AutomationJob | null> {
    const job = this.findJob(selector);
    if (!job) return null;
    await this.runJob(job, { reason: 'manual' });
    return job;
  }

  async tick(reference: Date = new Date()): Promise<void> {
    if (!this.running && reference === undefined) {
      return;
    }
    const now = reference.getTime();
    for (const job of this.jobs) {
      if (!job.enabled || job.trigger.type !== 'cron') continue;
      if (!job.trigger.nextRunAt) {
        const next = computeNextCronRun(job.trigger.expression, reference);
        job.trigger.nextRunAt = next ? next.toISOString() : undefined;
        continue;
      }
      const dueAt = Date.parse(job.trigger.nextRunAt);
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      await this.runJob(job, { reason: 'cron' });
    }
  }

  async handleWebhookTrigger(payload: GatewayWebhookPayload): Promise<number> {
    const triggerName = payload.name.trim().toLowerCase();
    if (!triggerName) return 0;
    const signature = extractSignature(payload.headers);
    let matched = 0;

    for (const job of this.jobs) {
      if (!job.enabled || job.trigger.type !== 'webhook') continue;
      if (job.trigger.name !== triggerName) continue;

      if (job.trigger.secret) {
        if (!signature) {
          continue;
        }
        const expected = hmacSignature(job.trigger.secret, payload.rawBody);
        if (!constantTimeEquals(expected, signature)) {
          continue;
        }
      }

      matched++;
      await this.runJob(job, {
        reason: 'webhook',
        webhook: {
          name: payload.name,
          payload: payload.body,
          rawBody: payload.rawBody,
        },
      });
    }

    this.eventBus.emit({
      type: 'automation:webhook:received',
      name: payload.name,
      matchedJobs: matched,
    });
    return matched;
  }
}

export function createAutomationService(options: {
  eventBus: EventBus;
  connectorRegistry: ConnectorRegistry;
  workDir?: string;
  jobsFile?: string;
}): AutomationService {
  return new AutomationService(options);
}
