import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { IndicatorStatus, JsonValue, StructuredLogger } from '../../plugin-sdk/index.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import type { ChannelRegistry } from '@slashbot/core/kernel/registries.js';
import type { LlmAdapter } from '@slashbot/core/agentic/llm/index.js';
import { classifyResponse, formatIntervalHuman, formatRelativeTime, parseInterval } from './helpers.js';

const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().int().positive().default(1_800_000),
  prompt: z.string().default('Review the HEARTBEAT.md checklist and report any issues or updates needed.'),
  deliveryConnectors: z.array(z.string()).default([]),
});

const HeartbeatStateSchema = z.object({
  totalRuns: z.number().int().nonnegative().default(0),
  totalAlerts: z.number().int().nonnegative().default(0),
  lastRunAt: z.string().optional(),
  lastResult: z.enum(['ok', 'alert', 'error']).optional(),
  lastError: z.string().optional(),
});

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  prompt: string;
  deliveryConnectors: string[];
}

export interface HeartbeatState {
  totalRuns: number;
  totalAlerts: number;
  lastRunAt?: string;
  lastResult?: 'ok' | 'alert' | 'error';
  lastError?: string;
}

/**
 * HeartbeatService — periodic LLM reflection engine.
 *
 * Reads HEARTBEAT.md, sends it to the LLM for review, tracks run statistics,
 * and delivers results to configured channels. State is persisted across
 * restarts, intervals can be changed on the fly (with immediate reschedule),
 * and alert classification uses structured LLM prefixes with keyword fallback.
 */
export class HeartbeatService {
  private config: HeartbeatConfig = {
    enabled: false,
    intervalMs: 30 * 60_000,
    prompt: 'Review the HEARTBEAT.md checklist and report any issues or updates needed.',
    deliveryConnectors: [],
  };
  private state: HeartbeatState = { totalRuns: 0, totalAlerts: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextRunAt: Date | null = null;
  private running = false;
  private indicatorUpdater: ((status: IndicatorStatus) => void) | null = null;

  setIndicatorUpdater(fn: (status: IndicatorStatus) => void): void {
    this.indicatorUpdater = fn;
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly llm: LlmAdapter | null,
    private readonly events: EventBus | undefined,
    private readonly channelsRegistry: ChannelRegistry | undefined,
    private readonly logger: StructuredLogger,
  ) {}

  private heartbeatMdPath(): string {
    return join(this.workspaceRoot, '.slashbot', 'HEARTBEAT.md');
  }

  private configPath(): string {
    return join(this.workspaceRoot, '.slashbot', 'heartbeat.json');
  }

  private statePath(): string {
    return join(this.workspaceRoot, '.slashbot', 'heartbeat-state.json');
  }

  async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath(), 'utf8');
      const result = HeartbeatConfigSchema.safeParse(JSON.parse(data));
      if (result.success) {
        this.config = { ...this.config, ...result.data };
      }
    } catch { /* use defaults */ }
  }

  async saveConfig(): Promise<void> {
    await fs.mkdir(join(this.workspaceRoot, '.slashbot'), { recursive: true });
    await fs.writeFile(this.configPath(), JSON.stringify(this.config, null, 2), 'utf8');
  }

  async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.statePath(), 'utf8');
      const result = HeartbeatStateSchema.safeParse(JSON.parse(data));
      if (result.success) {
        this.state = { ...this.state, ...result.data };
      }
    } catch { /* use defaults */ }
  }

  private async saveState(): Promise<void> {
    const dir = join(this.workspaceRoot, '.slashbot');
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = this.statePath() + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmpPath, this.statePath());
  }

  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  getState(): HeartbeatState {
    return { ...this.state };
  }

  getStatus(): { enabled: boolean; running: boolean; nextRunAt?: string } {
    return {
      enabled: this.config.enabled,
      running: this.running,
      ...(this.nextRunAt ? { nextRunAt: this.nextRunAt.toISOString() } : {}),
    };
  }

  async readHeartbeatMd(): Promise<string> {
    try {
      return await fs.readFile(this.heartbeatMdPath(), 'utf8');
    } catch {
      return '';
    }
  }

  async updateHeartbeatMd(content: string): Promise<void> {
    await fs.writeFile(this.heartbeatMdPath(), content, 'utf8');
  }

  private isContentEffectivelyEmpty(content: string): boolean {
    const stripped = content.replace(/^#+\s.*$/gm, '').trim();
    return stripped.length === 0;
  }

  async execute(options?: { prompt?: string; force?: boolean }): Promise<{ result: 'ok' | 'alert' | 'error'; response: string }> {
    if (this.running) {
      return { result: 'error', response: 'Heartbeat already running' };
    }

    this.running = true;
    this.indicatorUpdater?.('running');
    this.events?.publish('heartbeat:started', {});
    this.events?.publish('heartbeat:status', { status: 'running' });

    try {
      const heartbeatContent = await this.readHeartbeatMd();

      if (this.isContentEffectivelyEmpty(heartbeatContent)) {
        this.state.totalRuns++;
        this.state.lastRunAt = new Date().toISOString();
        this.state.lastResult = 'ok';
        return { result: 'ok', response: 'HEARTBEAT.md empty — skipped' };
      }

      if (!this.llm) {
        return { result: 'error', response: 'LLM not available for heartbeat' };
      }

      const prompt = options?.prompt ?? this.config.prompt;
      const fullPrompt = heartbeatContent
        ? `## Current HEARTBEAT.md\n${heartbeatContent} \n\n${prompt}`
        : prompt;

      const llmResult = await this.llm.complete({
        sessionId: 'heartbeat',
        agentId: 'default-agent',
        noTools: false,
        maxTokens: 4096,
        messages: [
          {
            role: 'system',
            content:
              'You are a heartbeat agent. Focus only on fulfilling the tasks contained in current HEARTBEAT.md content. Execute each task in HEARTBEAT.md using your tools. ' +
              'Do not report unless explicitly asked.'
          },
          { role: 'user', content: fullPrompt },
        ],
      });
      const response = llmResult.text;

      this.state.totalRuns++;
      this.state.lastRunAt = new Date().toISOString();

      const classification = classifyResponse(response);
      const result: 'ok' | 'alert' = classification === 'ok' ? 'ok' : 'alert';
      this.state.lastResult = result;
      if (result === 'alert') this.state.totalAlerts++;

      this.events?.publish('heartbeat:complete', { result, responseLength: response.length });
      this.indicatorUpdater?.(result === 'alert' ? 'error' : 'idle');
      this.events?.publish('heartbeat:status', { status: result === 'alert' ? 'error' : 'idle' });

      return { result, response };
    } catch (err) {
      this.state.totalRuns++;
      this.state.lastRunAt = new Date().toISOString();
      this.state.lastResult = 'error';
      this.state.lastError = String(err);
      this.events?.publish('heartbeat:error', { error: String(err) });
      this.indicatorUpdater?.('error');
      this.events?.publish('heartbeat:status', { status: 'error' });
      return { result: 'error', response: String(err) };
    } finally {
      this.running = false;
      await this.saveState().catch((e) => this.logger.warn('Failed to save heartbeat state', { error: String(e) }));
    }
  }

  start(): void {
    this.config.enabled = true;
    this.scheduleNext();
    this.indicatorUpdater?.('idle');
    this.events?.publish('heartbeat:status', { status: 'idle' });
    this.logger.info('Heartbeat started', { intervalMs: this.config.intervalMs });
  }

  stop(): void {
    this.config.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
    this.indicatorUpdater?.('off');
    this.events?.publish('heartbeat:status', { status: 'off' });
    this.logger.info('Heartbeat stopped');
  }

  async setInterval(value: string): Promise<void> {
    this.config.intervalMs = parseInterval(value);
    await this.saveConfig();
    if (this.config.enabled) this.scheduleNext();
  }

  async setPrompt(text: string): Promise<void> {
    this.config.prompt = text;
    await this.saveConfig();
  }

  formatStatus(): string {
    const config = this.config;
    const state = this.state;
    const lines: string[] = [];
    lines.push(`Heartbeat: ${config.enabled ? 'enabled' : 'disabled'}`);
    lines.push(`Interval: ${formatIntervalHuman(config.intervalMs)}`);
    if (this.nextRunAt) {
      lines.push(`Next run: ${formatRelativeTime(this.nextRunAt.toISOString())}`);
    }
    lines.push(`Total runs: ${state.totalRuns}`);
    lines.push(`Total alerts: ${state.totalAlerts}`);
    if (state.lastRunAt) {
      lines.push(`Last run: ${formatRelativeTime(state.lastRunAt)} (${state.lastResult ?? 'unknown'})`);
    }
    if (state.lastError) {
      lines.push(`Last error: ${state.lastError}`);
    }
    if (config.deliveryConnectors.length > 0) {
      lines.push(`Delivery: ${config.deliveryConnectors.join(', ')}`);
    }
    lines.push(`Prompt: ${config.prompt}`);
    return lines.join('\n');
  }

  addDeliveryConnector(channelId: string): void {
    const normalized = this.normalizeConnectorId(channelId);
    if (!this.config.deliveryConnectors.includes(normalized)) {
      this.config.deliveryConnectors.push(normalized);
    }
  }

  private normalizeConnectorId(id: string): string {
    const lower = id.toLowerCase().trim();
    if (lower === 'tg' || lower.startsWith('telegram') || /^\d{5,}$/.test(lower)) return 'telegram';
    if (lower === 'dc' || lower.startsWith('discord')) return 'discord';
    if (lower === 'tui' || lower === 'terminal' || lower === 'cli') return 'cli';
    return lower;
  }

  removeDeliveryConnector(channelId: string): void {
    this.config.deliveryConnectors = this.config.deliveryConnectors.filter((ch) => ch !== channelId);
  }

  private async deliverToConnectors(response: string, result: string): Promise<void> {
    if (this.config.deliveryConnectors.length === 0 || !this.channelsRegistry) return;

    const payload = `[Heartbeat ${result}] ${response.slice(0, 1000)}`;
    for (const channelId of this.config.deliveryConnectors) {
      const channel = this.channelsRegistry.get(channelId);
      if (channel) {
        try {
          await channel.send(payload);
        } catch (err) {
          this.logger.warn('Heartbeat delivery failed', { channelId, error: String(err) });
        }
      } else {
        this.logger.warn('Heartbeat delivery connector not found', { channelId });
      }
    }
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.config.enabled) {
      this.nextRunAt = null;
      return;
    }
    const MAX_TIMEOUT = 0x7FFFFFFF; // 2^31 - 1 (~24.8 days)
    const delay = Math.min(this.config.intervalMs, MAX_TIMEOUT);
    this.nextRunAt = new Date(Date.now() + delay);
    this.timer = setTimeout(() => {
      this.nextRunAt = null;
      void this.execute().then(() => {
        if (this.config.enabled) this.scheduleNext();
      });
    }, delay);
  }
}
