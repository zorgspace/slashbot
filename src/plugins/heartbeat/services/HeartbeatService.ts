/**
 * Heartbeat Service - Periodic AI Reflection System
 *
 * Implements OpenClaw-inspired heartbeat functionality:
 * - Periodic "wake-up" for the AI to reflect on its context
 * - HEARTBEAT.md checklist support
 * - HEARTBEAT_OK suppression
 */

import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/di/types';
import type { EventBus } from '../../../core/events/EventBus';
import type { GrokClient } from '../../../core/api';
import { display, formatToolAction } from '../../../core/ui';
import { getLocalSlashbotDir } from '../../../core/config/constants';
import {
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatAction,
  DEFAULT_HEARTBEAT_PROMPT,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  parseDuration,
  isWithinActiveHours,
  isHeartbeatContentEffectivelyEmpty,
  parseHeartbeatResponse,
} from './types';

// LLM handler type for processing heartbeat prompts
export type HeartbeatLLMHandler = (
  prompt: string,
) => Promise<{ response: string; thinking?: string; actions?: HeartbeatAction[] }>;

@injectable()
export class HeartbeatService {
  private config: FullHeartbeatConfig = {
    enabled: true,
    period: '30m',
    ackMaxChars: DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  };
  private state: HeartbeatState = { consecutiveOks: 0, totalRuns: 0, totalAlerts: 0 };
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private executing = false; // Guard against concurrent executions
  private lastTick: Date = new Date();
  private llmHandler: HeartbeatLLMHandler | null = null;
  private grokClient: GrokClient | null = null;
  private workDir: string = process.cwd();

  constructor(@inject(TYPES.EventBus) private eventBus: EventBus) {}

  setLLMHandler(handler: HeartbeatLLMHandler): void {
    this.llmHandler = handler;
  }

  setGrokClient(client: GrokClient): void {
    this.grokClient = client;
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

  private async loadConfig(): Promise<void> {
    try {
      const filePath = this.getHeartbeatConfigFile();
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const data = (await file.json()) as Record<string, unknown>;
        if (data.interval && !data.every && !data.period) {
          data.period = data.interval as string;
        }
        if (data.every && !data.period) {
          data.period = data.every as string;
        }
        this.config = { ...this.config, ...(data as Partial<FullHeartbeatConfig>) };
      }
    } catch {
      // Use defaults
    }
  }

  async saveConfig(config: Partial<FullHeartbeatConfig>): Promise<void> {
    const normalized = { ...config } as Partial<FullHeartbeatConfig> & {
      every?: string;
      interval?: string;
    };
    if (normalized.interval && !normalized.period) normalized.period = normalized.interval;
    if (normalized.every && !normalized.period) normalized.period = normalized.every;
    this.config = { ...this.config, ...normalized };

    const { mkdir } = await import('fs/promises');
    const slashbotDir = this.getSlashbotDir();
    await mkdir(slashbotDir, { recursive: true });
    await Bun.write(this.getHeartbeatConfigFile(), JSON.stringify(this.config, null, 2));
  }

  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(this.getHeartbeatStateFile());
      if (await file.exists()) {
        const data = await file.json();
        this.state = { ...this.state, ...data };
      }
    } catch {
      // Silently ignore load errors
    }
  }

  private async saveState(): Promise<void> {
    try {
      const { mkdir } = await import('fs/promises');
      const slashbotDir = this.getSlashbotDir();
      await mkdir(slashbotDir, { recursive: true });
      await Bun.write(this.getHeartbeatStateFile(), JSON.stringify(this.state, null, 2));
    } catch (err) {
      display.errorText(`[HEARTBEAT] Failed to save state: ${err}`);
    }
  }

  getConfig(): FullHeartbeatConfig {
    return { ...this.config };
  }

  getState(): HeartbeatState {
    return { ...this.state };
  }

  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      return;
    }

    this.running = true;
    this.lastTick = new Date();

    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        console.error(`[HEARTBEAT] Tick error: ${err?.message || err}`);
      });
    }, 60 * 1000);
  }

  stop(): void {
    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.config.enabled || !this.running) return;

    if (!isWithinActiveHours(this.config.activeHours)) {
      return;
    }

    const now = new Date();
    const intervalMs = parseDuration(this.config.period || '30m');
    const lastRun = this.state.lastRun ? new Date(this.state.lastRun) : null;

    if (lastRun) {
      const elapsed = now.getTime() - lastRun.getTime();
      if (elapsed < intervalMs) {
        return;
      }
    }

    await this.execute({ silent: true });
  }

  async execute(options?: { prompt?: string; silent?: boolean }): Promise<HeartbeatResult> {
    if (this.executing) {
      return {
        type: 'ok',
        content: 'Skipped - heartbeat already in progress',
        timestamp: new Date(),
        duration: 0,
      };
    }

    const silent = options?.silent ?? true;

    this.executing = true;
    const startTime = Date.now();

    this.eventBus.emit({
      type: 'heartbeat:started',
    });

    let result: HeartbeatResult;

    try {
      if (!this.llmHandler) {
        throw new Error('LLM handler not configured');
      }

      const promptInfo = await this.buildHeartbeatPrompt(options?.prompt);
      if (promptInfo.skipRun) {
        const duration = Date.now() - startTime;
        result = {
          type: 'ok',
          content: '',
          timestamp: new Date(),
          duration,
        };

        this.state.lastRun = new Date().toISOString();
        this.state.lastResult = 'ok';
        this.state.totalRuns++;
        this.state.consecutiveOks++;
        await this.saveState();
        if (!silent) {
          await this.displayResult(result);
        }
        this.eventBus.emit({
          type: 'heartbeat:complete',
          result,
        });
        return result;
      }

      const llmResult = await this.llmHandler(promptInfo.prompt);

      const parsed = parseHeartbeatResponse(
        llmResult.response,
        this.config.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
      );

      const duration = Date.now() - startTime;

      result = {
        type: parsed.type,
        content: parsed.content,
        reasoning: llmResult.thinking,
        timestamp: new Date(),
        duration,
        actions: llmResult.actions,
      };

      this.state.lastRun = new Date().toISOString();
      this.state.lastResult = parsed.type;
      this.state.totalRuns++;

      if (parsed.type === 'ok') {
        this.state.consecutiveOks++;
      } else {
        this.state.consecutiveOks = 0;
        this.state.totalAlerts++;
      }

      await this.saveState();

      if (!silent) {
        await this.displayResult(result);
      }

      this.eventBus.emit({
        type: 'heartbeat:complete',
        result,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error?.message || String(error);

      result = {
        type: 'error',
        content: errorMsg,
        timestamp: new Date(),
        duration,
      };

      this.state.lastRun = new Date().toISOString();
      await this.saveState().catch(() => {});

      if (!silent) {
        display.error(errorMsg);
      }

      this.eventBus.emit({
        type: 'heartbeat:error',
        error: errorMsg,
      });
    } finally {
      this.executing = false;
    }

    this.eventBus.emit({ type: 'prompt:redraw' });

    return result;
  }

  private async buildHeartbeatPrompt(
    customPrompt?: string,
  ): Promise<{ prompt: string; skipRun: boolean }> {
    const basePrompt = customPrompt || this.config.prompt || DEFAULT_HEARTBEAT_PROMPT;

    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    let heartbeatContext = '';

    try {
      const file = Bun.file(heartbeatMdPath);
      if (await file.exists()) {
        const content = await file.text();
        if (isHeartbeatContentEffectivelyEmpty(content)) {
          return { prompt: basePrompt, skipRun: true };
        }
        if (content.trim().length > 0) {
          heartbeatContext = `\n\n--- HEARTBEAT.md ---\n${content}\n--- END HEARTBEAT.md ---\n`;
        }
      }
    } catch {
      // No HEARTBEAT.md file
    }

    return { prompt: basePrompt + heartbeatContext, skipRun: false };
  }

  private async displayResult(result: HeartbeatResult): Promise<void> {
    const visibility = this.config.visibility || {};

    if (result.type === 'ok') {
      // Explicitly silent on OK heartbeats unless a future dedicated
      // UI mode is added. This avoids noisy "HEARTBEAT_OK" confirmations.
      return;
    } else if (result.type === 'alert') {
      const showAlerts = visibility.showAlerts ?? true;
      if (showAlerts && result.content) {
        const lines = result.content.split('\n').slice(0, 5);
        const preview = lines.join(' ').slice(0, 100);
        display.warningText(`  ⎿  ${preview}${lines.length > 5 ? '...' : ''}`);
      }
      display.appendAssistantMessage(formatToolAction('Heartbeat', 'reflection', { success: false }));
    }
  }

  getNextHeartbeat(): Date | null {
    if (!this.config.enabled || !this.running) return null;

    const intervalMs = parseDuration(this.config.period || '30m');
    const lastRun = this.state.lastRun ? new Date(this.state.lastRun) : new Date();

    return new Date(lastRun.getTime() + intervalMs);
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    interval: string;
    nextRun: string | null;
    lastRun: string | null;
    consecutiveOks: number;
    totalRuns: number;
    totalAlerts: number;
  } {
    const next = this.getNextHeartbeat();

    return {
      running: this.running,
      enabled: this.config.enabled ?? true,
      interval: this.config.period || '30m',
      nextRun: next ? this.formatRelativeTime(next) : null,
      lastRun: this.state.lastRun ? this.formatRelativeTime(new Date(this.state.lastRun)) : null,
      consecutiveOks: this.state.consecutiveOks,
      totalRuns: this.state.totalRuns,
      totalAlerts: this.state.totalAlerts,
    };
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const absDiff = Math.abs(diff);

    const minutes = Math.floor(absDiff / 60000);
    const hours = Math.floor(minutes / 60);

    if (diff < 0) {
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
      return date.toLocaleDateString();
    } else {
      if (minutes < 1) return 'now';
      if (minutes < 60) return `in ${minutes}m`;
      if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
      return date.toLocaleDateString();
    }
  }

  async updateHeartbeatMd(content: string): Promise<void> {
    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    await Bun.write(heartbeatMdPath, content);
  }

  async readHeartbeatMd(): Promise<string | null> {
    try {
      const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
      const file = Bun.file(heartbeatMdPath);
      if (await file.exists()) {
        return await file.text();
      }
    } catch {
      // Ignore
    }
    return null;
  }
}

export function createHeartbeatService(eventBus: EventBus): HeartbeatService {
  return new HeartbeatService(eventBus);
}
