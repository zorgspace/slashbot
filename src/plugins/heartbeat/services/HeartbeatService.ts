/**
 * Heartbeat Service - Periodic AI Reflection System
 *
 * Reimplemented from OpenClaw heartbeat behavior:
 * - robust scheduling with due-time timers
 * - HEARTBEAT.md effective-empty skip handling
 * - HEARTBEAT_OK normalization with ack threshold
 * - visibility-gated output and duplicate alert suppression
 */

import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/di/types';
import type { EventBus } from '../../../core/events/EventBus';
import { display, formatToolAction } from '../../../core/ui';
import { getLocalSlashbotDir } from '../../../core/config/constants';
import {
  type HeartbeatConfig,
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatAction,
  type HeartbeatSkipReason,
  DEFAULT_HEARTBEAT_PROMPT,
  DEFAULT_HEARTBEAT_EVERY,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_DEDUPE_WINDOW_MS,
  parseDurationOrNull,
  isWithinActiveHours,
  isHeartbeatContentEffectivelyEmpty,
  parseHeartbeatResponse,
} from './types';

export type HeartbeatLLMHandler = (
  prompt: string,
  context: { reason: string; executeActions: boolean },
) => Promise<{ response: string; thinking?: string; actions?: HeartbeatAction[] }>;

type HeartbeatExecuteOptions = {
  prompt?: string;
  silent?: boolean;
  reason?: string;
  force?: boolean;
};

const DEFAULT_VISIBILITY = {
  showOk: false,
  showAlerts: true,
  useIndicator: true,
} as const;

const COALESCED_WAKE_MS = 250;
const RETRY_WAKE_MS = 1000;

@injectable()
export class HeartbeatService {
  private config: FullHeartbeatConfig = {
    enabled: true,
    period: DEFAULT_HEARTBEAT_EVERY,
    ackMaxChars: DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    visibility: { ...DEFAULT_VISIBILITY },
    includeReasoning: false,
    dedupeWindowMs: DEFAULT_HEARTBEAT_DEDUPE_WINDOW_MS,
  };

  private state: HeartbeatState = {
    consecutiveOks: 0,
    totalRuns: 0,
    totalAlerts: 0,
    totalSkips: 0,
  };

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextDueAt: number | null = null;
  private running = false;
  private executing = false;
  private pendingWakeReason: string | null = null;
  private llmHandler: HeartbeatLLMHandler | null = null;
  private workDir = process.cwd();

  constructor(@inject(TYPES.EventBus) private eventBus: EventBus) {}

  setLLMHandler(handler: HeartbeatLLMHandler): void {
    this.llmHandler = handler;
  }

  setWorkDir(dir: string): void {
    this.workDir = dir;
  }

  private getSlashbotDir(): string {
    return getLocalSlashbotDir(this.workDir);
  }

  private getHeartbeatStateFile(): string {
    return `${this.getSlashbotDir()}/heartbeat-state.json`;
  }

  private getHeartbeatConfigFile(): string {
    return `${this.getSlashbotDir()}/heartbeat.json`;
  }

  async init(): Promise<void> {
    await this.loadConfig();
    await this.loadState();
  }

  private hasOwn<T extends object>(obj: T, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  private normalizeAckMaxChars(value: unknown): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      return DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
    }
    return Math.max(0, Math.floor(parsed));
  }

  private mergeConfig(patchRaw: Partial<HeartbeatConfig> & { dedupeWindowMs?: unknown }): void {
    const patch = patchRaw ?? {};
    const periodInput = patch.period ?? patch.every ?? patch.interval;
    const period =
      typeof periodInput === 'string' && periodInput.trim()
        ? periodInput.trim()
        : this.config.period || DEFAULT_HEARTBEAT_EVERY;

    const visibilityPatch = patch.visibility ?? {};
    const visibility = {
      showOk: visibilityPatch.showOk ?? this.config.visibility.showOk ?? DEFAULT_VISIBILITY.showOk,
      showAlerts:
        visibilityPatch.showAlerts ??
        this.config.visibility.showAlerts ??
        DEFAULT_VISIBILITY.showAlerts,
      useIndicator:
        visibilityPatch.useIndicator ??
        this.config.visibility.useIndicator ??
        DEFAULT_VISIBILITY.useIndicator,
    };

    let dedupeWindowMs = this.config.dedupeWindowMs || DEFAULT_HEARTBEAT_DEDUPE_WINDOW_MS;
    if (this.hasOwn(patch, 'dedupeWindow')) {
      dedupeWindowMs =
        parseDurationOrNull(patch.dedupeWindow, { defaultUnit: 'h' }) ?? dedupeWindowMs;
    } else if (
      this.hasOwn(patch, 'dedupeWindowMs') &&
      typeof patch.dedupeWindowMs === 'number' &&
      Number.isFinite(patch.dedupeWindowMs) &&
      patch.dedupeWindowMs > 0
    ) {
      dedupeWindowMs = patch.dedupeWindowMs;
    }

    this.config = {
      enabled:
        typeof patch.enabled === 'boolean'
          ? patch.enabled
          : (this.config.enabled ?? true),
      period,
      prompt: this.hasOwn(patch, 'prompt') ? patch.prompt : this.config.prompt,
      model: this.hasOwn(patch, 'model') ? patch.model : this.config.model,
      activeHours: this.hasOwn(patch, 'activeHours') ? patch.activeHours : this.config.activeHours,
      ackMaxChars: this.hasOwn(patch, 'ackMaxChars')
        ? this.normalizeAckMaxChars(patch.ackMaxChars)
        : this.normalizeAckMaxChars(this.config.ackMaxChars),
      visibility,
      includeReasoning:
        typeof patch.includeReasoning === 'boolean'
          ? patch.includeReasoning
          : this.config.includeReasoning ?? false,
      dedupeWindowMs,
    };
  }

  private async ensureSlashbotDir(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(this.getSlashbotDir(), { recursive: true });
  }

  private async loadConfig(): Promise<void> {
    try {
      const file = Bun.file(this.getHeartbeatConfigFile());
      if (!(await file.exists())) return;
      const data = (await file.json()) as Partial<HeartbeatConfig> & { dedupeWindowMs?: unknown };
      this.mergeConfig(data);
    } catch {
      // Keep defaults when config is missing or invalid.
    }
  }

  async saveConfig(config: Partial<HeartbeatConfig> & { dedupeWindowMs?: unknown }): Promise<void> {
    this.mergeConfig(config);
    await this.ensureSlashbotDir();
    await Bun.write(
      this.getHeartbeatConfigFile(),
      JSON.stringify(
        {
          enabled: this.config.enabled,
          period: this.config.period,
          prompt: this.config.prompt,
          model: this.config.model,
          activeHours: this.config.activeHours,
          ackMaxChars: this.config.ackMaxChars,
          visibility: this.config.visibility,
          includeReasoning: this.config.includeReasoning,
          dedupeWindowMs: this.config.dedupeWindowMs,
        },
        null,
        2,
      ),
    );

    if (this.running) {
      if (!this.config.enabled) {
        this.clearTickTimer();
        this.nextDueAt = null;
      } else {
        this.resetIntervalSchedule();
      }
    }
  }

  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(this.getHeartbeatStateFile());
      if (!(await file.exists())) return;
      const data = (await file.json()) as Partial<HeartbeatState>;
      this.state = {
        ...this.state,
        ...data,
        consecutiveOks:
          typeof data.consecutiveOks === 'number' && Number.isFinite(data.consecutiveOks)
            ? data.consecutiveOks
            : this.state.consecutiveOks,
        totalRuns:
          typeof data.totalRuns === 'number' && Number.isFinite(data.totalRuns)
            ? data.totalRuns
            : this.state.totalRuns,
        totalAlerts:
          typeof data.totalAlerts === 'number' && Number.isFinite(data.totalAlerts)
            ? data.totalAlerts
            : this.state.totalAlerts,
        totalSkips:
          typeof data.totalSkips === 'number' && Number.isFinite(data.totalSkips)
            ? data.totalSkips
            : this.state.totalSkips,
      };
    } catch {
      // Ignore corrupt state and continue.
    }
  }

  private async saveState(): Promise<void> {
    try {
      await this.ensureSlashbotDir();
      await Bun.write(this.getHeartbeatStateFile(), JSON.stringify(this.state, null, 2));
    } catch (err) {
      display.errorText(`[HEARTBEAT] Failed to save state: ${err}`);
    }
  }

  getConfig(): FullHeartbeatConfig {
    return {
      ...this.config,
      visibility: { ...this.config.visibility },
    };
  }

  getState(): HeartbeatState {
    return { ...this.state };
  }

  private resolveIntervalMs(): number | null {
    return parseDurationOrNull(this.config.period, { defaultUnit: 'm' });
  }

  private clearTickTimer(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  private scheduleNextTick(): void {
    this.clearTickTimer();
    if (!this.running || !this.config.enabled) return;

    const intervalMs = this.resolveIntervalMs();
    if (!intervalMs) {
      this.nextDueAt = null;
      return;
    }

    const now = Date.now();
    if (!this.nextDueAt || this.nextDueAt <= 0) {
      this.nextDueAt = now + intervalMs;
    }
    const delay = Math.max(0, this.nextDueAt - now);
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.requestWake('interval', 0);
    }, delay);
    this.tickTimer.unref?.();
  }

  private resetIntervalSchedule(): void {
    const intervalMs = this.resolveIntervalMs();
    if (!intervalMs) {
      this.nextDueAt = null;
      this.clearTickTimer();
      return;
    }
    this.nextDueAt = Date.now() + intervalMs;
    this.scheduleNextTick();
  }

  private requestWake(reason: string, coalesceMs: number = COALESCED_WAKE_MS): void {
    this.pendingWakeReason = reason;
    if (this.wakeTimer) return;

    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      const nextReason = this.pendingWakeReason ?? 'requested';
      this.pendingWakeReason = null;
      this.execute({ reason: nextReason, silent: true }).catch(() => {
        this.requestWake('retry', RETRY_WAKE_MS);
      });
    }, Math.max(0, coalesceMs));
    this.wakeTimer.unref?.();
  }

  start(): void {
    if (this.running) return;
    if (!this.config.enabled) return;
    if (!this.resolveIntervalMs()) return;
    this.running = true;
    this.resetIntervalSchedule();
  }

  stop(): void {
    this.running = false;
    this.nextDueAt = null;
    this.pendingWakeReason = null;
    this.clearTickTimer();
    this.clearWakeTimer();
  }

  private createSkippedResult(params: {
    skipReason: HeartbeatSkipReason;
    startedAt: number;
    silent: boolean;
    persist: boolean;
    reason?: string;
  }): HeartbeatResult {
    const now = Date.now();
    const result: HeartbeatResult = {
      type: 'ok',
      content: '',
      timestamp: new Date(now),
      duration: now - params.startedAt,
      status: 'skipped',
      skipReason: params.skipReason,
    };

    if (params.persist) {
      this.state.totalSkips += 1;
      this.state.lastSkippedReason = params.skipReason;
      this.state.lastDurationMs = result.duration;
    }

    if (!params.silent) {
      display.renderMarkdown(`Heartbeat skipped (${params.skipReason})`, true);
    }

    this.eventBus.emit({
      type: 'heartbeat:complete',
      result,
      reason: params.reason,
    });

    return result;
  }

  private async createAndPersistSkippedResult(params: {
    skipReason: HeartbeatSkipReason;
    startedAt: number;
    silent: boolean;
    persist: boolean;
    reason?: string;
  }): Promise<HeartbeatResult> {
    const result = this.createSkippedResult(params);
    if (params.persist) {
      await this.saveState();
    }
    return result;
  }

  private appendRuntimeContextLines(text: string, nowMs: number, reason: string): string {
    const base = text.trimEnd();
    const lines: string[] = [];

    if (!base.includes('Current time:')) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
      const timestamp = new Date(nowMs).toISOString();
      lines.push(`Current time: ${timestamp} (${timezone})`);
    }

    if (!base.includes('Trigger reason:')) {
      lines.push(`Trigger reason: ${reason}`);
    }

    if (lines.length === 0) {
      return base;
    }

    return base ? `${base}\n${lines.join('\n')}` : lines.join('\n');
  }

  private async buildHeartbeatPrompt(
    customPrompt: string | undefined,
    nowMs: number,
    reason: string,
  ): Promise<{ prompt?: string; skipReason?: HeartbeatSkipReason }> {
    const basePrompt = (customPrompt || this.config.prompt || DEFAULT_HEARTBEAT_PROMPT).trim();
    const prompt = this.appendRuntimeContextLines(basePrompt, nowMs, reason);

    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    try {
      const file = Bun.file(heartbeatMdPath);
      if (!(await file.exists())) return { prompt };

      const content = await file.text();
      if (isHeartbeatContentEffectivelyEmpty(content)) {
        return { skipReason: 'empty-heartbeat-file' };
      }
      if (!content.trim()) {
        return { prompt };
      }

      return {
        prompt: `${prompt}\n\n--- HEARTBEAT.md ---\n${content}\n--- END HEARTBEAT.md ---`,
      };
    } catch {
      return { prompt };
    }
  }

  private isDuplicateAlert(text: string, nowMs: number): boolean {
    const current = text.trim();
    if (!current) return false;

    const previous = (this.state.lastHeartbeatText || '').trim();
    const previousAt = this.state.lastHeartbeatSentAt;
    if (!previous || typeof previousAt !== 'number') return false;

    return current === previous && nowMs - previousAt < this.config.dedupeWindowMs;
  }

  private async displayResult(result: HeartbeatResult): Promise<void> {
    const visibility = this.config.visibility;

    if (result.status === 'skipped') {
      return;
    }

    if (result.type === 'ok') {
      if (!visibility.showOk) return;
      display.successText('  Heartbeat OK');
      display.appendAssistantMessage(
        formatToolAction('Heartbeat', 'ack', {
          success: true,
          summary: 'HEARTBEAT_OK',
        }),
      );
      return;
    }

    if (result.type === 'alert') {
      if (!visibility.showAlerts) return;
      if (result.content) {
        const lines = result.content.split('\n').slice(0, 5);
        const preview = lines.join(' ').trim().slice(0, 180);
        display.warningText(`  -> ${preview}${result.content.length > preview.length ? '...' : ''}`);
      }
      display.appendAssistantMessage(formatToolAction('Heartbeat', 'reflection', { success: false }));
      return;
    }

    display.error(result.content || 'Heartbeat error');
  }

  private async runOnce(options: Required<HeartbeatExecuteOptions>): Promise<HeartbeatResult> {
    const startedAt = Date.now();
    const reason = options.reason || 'manual';

    this.eventBus.emit({
      type: 'heartbeat:started',
      reason,
    });

    const visibility = this.config.visibility;

    if (!this.config.enabled && !options.force) {
      return this.createAndPersistSkippedResult({
        skipReason: 'disabled',
        startedAt,
        silent: options.silent,
        persist: true,
        reason,
      });
    }

    if (reason === 'interval' && !isWithinActiveHours(this.config.activeHours, startedAt)) {
      return this.createAndPersistSkippedResult({
        skipReason: 'quiet-hours',
        startedAt,
        silent: options.silent,
        persist: true,
        reason,
      });
    }

    if (!visibility.showAlerts && !visibility.showOk && !visibility.useIndicator) {
      return this.createAndPersistSkippedResult({
        skipReason: 'alerts-disabled',
        startedAt,
        silent: options.silent,
        persist: true,
        reason,
      });
    }

    const promptInfo = await this.buildHeartbeatPrompt(options.prompt, startedAt, reason);
    if (promptInfo.skipReason || !promptInfo.prompt) {
      return this.createAndPersistSkippedResult({
        skipReason: promptInfo.skipReason ?? 'empty-heartbeat-file',
        startedAt,
        silent: options.silent,
        persist: true,
        reason,
      });
    }

    if (!this.llmHandler) {
      throw new Error('LLM handler not configured');
    }

    const llmResult = await this.llmHandler(promptInfo.prompt, {
      reason,
      executeActions: reason !== 'interval',
    });
    const parsed = parseHeartbeatResponse(llmResult.response, this.config.ackMaxChars);
    const now = Date.now();
    const duration = now - startedAt;

    if (parsed.type === 'alert' && this.isDuplicateAlert(parsed.content, now)) {
      return this.createAndPersistSkippedResult({
        skipReason: 'duplicate',
        startedAt,
        silent: options.silent,
        persist: true,
        reason,
      });
    }

    const result: HeartbeatResult = {
      type: parsed.type,
      content: parsed.content,
      reasoning: this.config.includeReasoning ? llmResult.thinking : undefined,
      timestamp: new Date(now),
      duration,
      actions: llmResult.actions,
      status: 'ran',
      rawResponse: llmResult.response,
      didStripHeartbeatToken: parsed.didStripHeartbeatToken,
    };

    this.state.lastRun = result.timestamp.toISOString();
    this.state.lastDurationMs = result.duration;
    this.state.lastSkippedReason = undefined;
    this.state.lastError = undefined;
    this.state.totalRuns += 1;
    this.state.lastResult = result.type;

    if (result.type === 'ok') {
      this.state.consecutiveOks += 1;
    } else if (result.type === 'alert') {
      this.state.consecutiveOks = 0;
      this.state.totalAlerts += 1;
      if (result.content.trim()) {
        this.state.lastHeartbeatText = result.content;
        this.state.lastHeartbeatSentAt = now;
      }
    } else {
      this.state.consecutiveOks = 0;
      this.state.lastError = result.content;
    }

    await this.saveState();

    if (!options.silent) {
      await this.displayResult(result);
    }

    this.eventBus.emit({
      type: 'heartbeat:complete',
      result,
      reason,
    });

    return result;
  }

  async execute(options: HeartbeatExecuteOptions = {}): Promise<HeartbeatResult> {
    const silent = options.silent ?? true;
    const reason = options.reason ?? 'manual';
    const force = options.force ?? reason !== 'interval';

    if (this.executing) {
      this.requestWake(reason, RETRY_WAKE_MS);
      return {
        type: 'ok',
        content: 'Skipped - heartbeat already in progress',
        timestamp: new Date(),
        duration: 0,
        status: 'skipped',
        skipReason: 'in-progress',
      };
    }

    this.executing = true;
    const startedAt = Date.now();
    let result: HeartbeatResult;

    try {
      result = await this.runOnce({
        prompt: options.prompt ?? this.config.prompt ?? DEFAULT_HEARTBEAT_PROMPT,
        silent,
        reason,
        force,
      });
    } catch (error: any) {
      const now = Date.now();
      const message = error?.message || String(error);
      result = {
        type: 'error',
        content: message,
        timestamp: new Date(now),
        duration: Date.now() - startedAt,
        status: 'ran',
      };

      this.state.lastRun = result.timestamp.toISOString();
      this.state.lastResult = 'error';
      this.state.lastError = message;
      this.state.lastDurationMs = result.duration;
      this.state.consecutiveOks = 0;
      this.state.totalRuns += 1;
      await this.saveState().catch(() => {});

      if (!silent) {
        display.error(message);
      }

      this.eventBus.emit({
        type: 'heartbeat:error',
        error: message,
      });
      this.eventBus.emit({
        type: 'heartbeat:complete',
        result,
        reason,
      });
    } finally {
      this.executing = false;
      if (this.running && this.config.enabled) {
        this.resetIntervalSchedule();
      }
      this.eventBus.emit({ type: 'prompt:redraw' });
    }

    return result;
  }

  getNextHeartbeat(): Date | null {
    if (!this.running || !this.config.enabled || !this.nextDueAt) return null;
    return new Date(this.nextDueAt);
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    interval: string;
    nextRun: string | null;
    lastRun: string | null;
    lastResult: string | null;
    lastSkippedReason: string | null;
    consecutiveOks: number;
    totalRuns: number;
    totalAlerts: number;
    totalSkips: number;
  } {
    const next = this.getNextHeartbeat();
    return {
      running: this.running,
      enabled: this.config.enabled,
      interval: this.config.period,
      nextRun: next ? this.formatRelativeTime(next) : null,
      lastRun: this.state.lastRun ? this.formatRelativeTime(new Date(this.state.lastRun)) : null,
      lastResult: this.state.lastResult ?? null,
      lastSkippedReason: this.state.lastSkippedReason ?? null,
      consecutiveOks: this.state.consecutiveOks,
      totalRuns: this.state.totalRuns,
      totalAlerts: this.state.totalAlerts,
      totalSkips: this.state.totalSkips,
    };
  }

  private formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diff = date.getTime() - now;
    const abs = Math.abs(diff);
    const minutes = Math.floor(abs / 60000);
    const hours = Math.floor(minutes / 60);

    if (diff < 0) {
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
      return date.toLocaleDateString();
    }

    if (minutes < 1) return 'now';
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
    return date.toLocaleDateString();
  }

  async updateHeartbeatMd(content: string): Promise<void> {
    await Bun.write(`${this.workDir}/HEARTBEAT.md`, content);
  }

  async readHeartbeatMd(): Promise<string | null> {
    try {
      const file = Bun.file(`${this.workDir}/HEARTBEAT.md`);
      if (!(await file.exists())) return null;
      return await file.text();
    } catch {
      return null;
    }
  }
}

export function createHeartbeatService(eventBus: EventBus): HeartbeatService {
  return new HeartbeatService(eventBus);
}
