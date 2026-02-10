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
import { display } from '../../../core/ui';
import { HOME_SLASHBOT_DIR } from '../../../core/config/constants';
import {
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatAction,
  DEFAULT_HEARTBEAT_PROMPT,
  parseDuration,
  isWithinActiveHours,
  parseHeartbeatResponse,
} from './types';

const HEARTBEAT_STATE_FILE = `${HOME_SLASHBOT_DIR}/heartbeat-state.json`;
const HEARTBEAT_CONFIG_FILE = `${HOME_SLASHBOT_DIR}/heartbeat.json`;

// LLM handler type for processing heartbeat prompts
export type HeartbeatLLMHandler = (
  prompt: string,
) => Promise<{ response: string; thinking?: string; actions?: HeartbeatAction[] }>;

@injectable()
export class HeartbeatService {
  private config: FullHeartbeatConfig = { enabled: true, period: '30m' };
  private state: HeartbeatState = { consecutiveOks: 0, totalRuns: 0, totalAlerts: 0 };
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private executing = false; // Guard against concurrent executions
  private lastTick: Date = new Date();
  private llmHandler: HeartbeatLLMHandler | null = null;
  private grokClient: GrokClient | null = null;
  private workDir: string = process.cwd()

  constructor(
    @inject(TYPES.EventBus) private eventBus: EventBus,
  ) {}

  setLLMHandler(handler: HeartbeatLLMHandler): void {
    this.llmHandler = handler;
  }

  setGrokClient(client: GrokClient): void {
    this.grokClient = client;
  }

  setWorkDir(dir: string): void {
    this.workDir = dir;
  }

  async init(): Promise<void> {
    await this.loadConfig();
    await this.loadState();
  }

  private async loadConfig(): Promise<void> {
    try {
      const file = Bun.file(HEARTBEAT_CONFIG_FILE);
      if (await file.exists()) {
        const data = await file.json();
        if (data.interval && !data.every && !data.period) {
          data.period = data.interval;
        }
        if (data.every && !data.period) {
          data.period = data.every;
        }
        this.config = { ...this.config, ...data };
      }
    } catch {
      // Use defaults
    }
  }

  async saveConfig(config: Partial<FullHeartbeatConfig>): Promise<void> {
    this.config = { ...this.config, ...config };

    const { mkdir } = await import('fs/promises');
    await mkdir(HOME_SLASHBOT_DIR, { recursive: true });
    await Bun.write(HEARTBEAT_CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(HEARTBEAT_STATE_FILE);
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
      await mkdir(HOME_SLASHBOT_DIR, { recursive: true });
      await Bun.write(HEARTBEAT_STATE_FILE, JSON.stringify(this.state, null, 2));
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

    await this.execute();
  }

  async execute(options?: { prompt?: string }): Promise<HeartbeatResult> {
    if (this.executing) {
      return {
        type: 'ok',
        content: 'Skipped - heartbeat already in progress',
        timestamp: new Date(),
        duration: 0,
      };
    }

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

      const prompt = await this.buildHeartbeatPrompt(options?.prompt);

      const llmResult = await this.llmHandler(prompt);

      const parsed = parseHeartbeatResponse(llmResult.response, this.config.ackMaxChars || 300);

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

      await this.displayResult(result);

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

      display.error(errorMsg);

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

  private async buildHeartbeatPrompt(customPrompt?: string): Promise<string> {
    const basePrompt = customPrompt || this.config.prompt || DEFAULT_HEARTBEAT_PROMPT;

    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    let heartbeatContext = '';

    try {
      const file = Bun.file(heartbeatMdPath);
      if (await file.exists()) {
        const content = await file.text();
        const meaningful = content.replace(/^#+\s*$/gm, '').trim();
        if (meaningful.length > 0) {
          heartbeatContext = `\n\n--- HEARTBEAT.md ---\n${content}\n--- END HEARTBEAT.md ---\n`;
        }
      }
    } catch {
      // No HEARTBEAT.md file
    }

    return basePrompt + heartbeatContext;
  }

  private async displayResult(result: HeartbeatResult): Promise<void> {
    const visibility = this.config.visibility || {};

    if (result.type === 'ok') {
      const showOk = visibility.showOk ?? false;
      if (showOk || result.content) {
        display.heartbeatResult(true);
      } else {
        display.muted('  ⎿  OK');
      }
    } else if (result.type === 'alert') {
      const showAlerts = visibility.showAlerts ?? true;
      if (showAlerts && result.content) {
        const lines = result.content.split('\n').slice(0, 5);
        const preview = lines.join(' ').slice(0, 100);
        display.warningText(`  ⎿  ${preview}${lines.length > 5 ? '...' : ''}`);
      }
      display.heartbeatResult(false);
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

export function createHeartbeatService(
  eventBus: EventBus,
): HeartbeatService {
  return new HeartbeatService(eventBus);
}
