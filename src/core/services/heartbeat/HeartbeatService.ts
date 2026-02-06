/**
 * Heartbeat Service - Periodic AI Reflection System
 *
 * Implements OpenClaw-inspired heartbeat functionality:
 * - Periodic "wake-up" for the AI to reflect on its context
 * - HEARTBEAT.md checklist support
 * - Alert routing to connectors
 * - HEARTBEAT_OK suppression
 */

import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../di/types';
import type { EventBus } from '../../events/EventBus';
import type { ConnectorRegistry } from '../ConnectorRegistry';
import type { GrokClient } from '../../api/grok';
import { c, colors, step } from '../../ui/colors';
import { HOME_SLASHBOT_DIR } from '../../constants';
import {
  type HeartbeatConfig,
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatTarget,
  type HeartbeatAction,
  DEFAULT_HEARTBEAT_PROMPT,
  parseDuration,
  formatDuration,
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
  private config: FullHeartbeatConfig = { enabled: true, every: '30m', target: 'cli' };
  private state: HeartbeatState = { consecutiveOks: 0, totalRuns: 0, totalAlerts: 0 };
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private executing = false; // Guard against concurrent executions
  private lastTick: Date = new Date();
  private llmHandler: HeartbeatLLMHandler | null = null;
  private grokClient: GrokClient | null = null;
  private workDir: string = process.cwd();

  constructor(
    @inject(TYPES.EventBus) private eventBus: EventBus,
    @inject(TYPES.ConnectorRegistry) private connectorRegistry: ConnectorRegistry,
  ) {}

  /**
   * Set the LLM handler for executing heartbeat prompts
   */
  setLLMHandler(handler: HeartbeatLLMHandler): void {
    this.llmHandler = handler;
  }

  /**
   * Set the Grok client reference (for direct API access if needed)
   */
  setGrokClient(client: GrokClient): void {
    this.grokClient = client;
  }

  /**
   * Set the working directory for HEARTBEAT.md lookup
   */
  setWorkDir(dir: string): void {
    this.workDir = dir;
  }

  /**
   * Initialize the heartbeat service
   */
  async init(): Promise<void> {
    await this.loadConfig();
    await this.loadState();
  }

  /**
   * Load configuration from disk
   */
  private async loadConfig(): Promise<void> {
    try {
      const file = Bun.file(HEARTBEAT_CONFIG_FILE);
      if (await file.exists()) {
        const data = await file.json();
        // Normalize config: support both "interval" and "every" field names
        if (data.interval && !data.every) {
          data.every = data.interval;
        }
        this.config = { ...this.config, ...data };
      }
    } catch {
      // Use defaults
    }
  }

  /**
   * Save configuration to disk
   */
  async saveConfig(config: Partial<FullHeartbeatConfig>): Promise<void> {
    this.config = { ...this.config, ...config };

    const { mkdir } = await import('fs/promises');
    await mkdir(HOME_SLASHBOT_DIR, { recursive: true });
    await Bun.write(HEARTBEAT_CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  /**
   * Load state from disk
   */
  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(HEARTBEAT_STATE_FILE);
      if (await file.exists()) {
        const data = await file.json();
        this.state = { ...this.state, ...data };

        // State restored silently - status shown in banner
      }
    } catch {
      // Silently ignore load errors - will use defaults
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(HOME_SLASHBOT_DIR, { recursive: true });
      await Bun.write(HEARTBEAT_STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error(c.error(`[HEARTBEAT] Failed to save state: ${err}`));
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): FullHeartbeatConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * Start the heartbeat service
   */
  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      return;
    }

    this.running = true;
    this.lastTick = new Date();

    // Check every minute if it's time for a heartbeat
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        console.error(`[HEARTBEAT] Tick error: ${err?.message || err}`);
      });
    }, 60 * 1000); // Check every minute
  }

  /**
   * Stop the heartbeat service
   */
  stop(): void {
    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Check if it's time to run a heartbeat
   */
  private async tick(): Promise<void> {
    if (!this.config.enabled || !this.running) return;

    // Check active hours
    if (!isWithinActiveHours(this.config.activeHours)) {
      return;
    }

    const now = new Date();
    const intervalMs = parseDuration(this.config.every || '30m');
    const lastRun = this.state.lastRun ? new Date(this.state.lastRun) : null;

    // Check if enough time has passed since last run
    if (lastRun) {
      const elapsed = now.getTime() - lastRun.getTime();
      if (elapsed < intervalMs) {
        return;
      }
    }

    // Execute heartbeat
    await this.execute();
  }

  /**
   * Execute a heartbeat immediately (manual or scheduled)
   */
  async execute(options?: { prompt?: string; target?: HeartbeatTarget }): Promise<HeartbeatResult> {
    // Prevent concurrent executions - if already running, skip this one
    if (this.executing) {
      return {
        type: 'ok',
        content: 'Skipped - heartbeat already in progress',
        timestamp: new Date(),
        duration: 0,
        target: options?.target || this.config.target || 'cli',
      };
    }

    this.executing = true;
    const startTime = Date.now();
    const target = options?.target || this.config.target || 'cli';

    // Emit heartbeat started event
    this.eventBus.emit({
      type: 'heartbeat:started',
    } as any);

    // Display heartbeat start using step format
    console.log('');
    step.heartbeat('reflection');

    let result: HeartbeatResult;

    try {
      if (!this.llmHandler) {
        throw new Error('LLM handler not configured');
      }

      // Build the heartbeat prompt
      const prompt = await this.buildHeartbeatPrompt(options?.prompt);

      // Execute via LLM
      const llmResult = await this.llmHandler(prompt);

      // Parse the response
      const parsed = parseHeartbeatResponse(
        llmResult.response,
        this.config.ackMaxChars || 300,
      );

      const duration = Date.now() - startTime;

      result = {
        type: parsed.type,
        content: parsed.content,
        reasoning: llmResult.thinking,
        timestamp: new Date(),
        duration,
        target,
        actions: llmResult.actions,
      };

      // Update state
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

      // Display result
      await this.displayResult(result);

      // Route alerts to connectors
      if (parsed.type === 'alert' && target !== 'none') {
        await this.routeAlert(result);
      }

      // Emit completion event
      this.eventBus.emit({
        type: 'heartbeat:complete',
        result,
      } as any);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error?.message || String(error);

      result = {
        type: 'error',
        content: errorMsg,
        timestamp: new Date(),
        duration,
        target,
      };

      // Update lastRun even on error to prevent retry storms
      this.state.lastRun = new Date().toISOString();
      await this.saveState().catch(() => {}); // Ignore save errors

      // Display error
      step.error(errorMsg);

      // Emit error event
      this.eventBus.emit({
        type: 'heartbeat:error',
        error: errorMsg,
      } as any);
    } finally {
      // Always reset executing flag to allow future heartbeats
      this.executing = false;
    }

    // Redraw prompt
    this.eventBus.emit({ type: 'prompt:redraw' });

    return result;
  }

  /**
   * Build the heartbeat prompt with HEARTBEAT.md context
   */
  private async buildHeartbeatPrompt(customPrompt?: string): Promise<string> {
    const basePrompt = customPrompt || this.config.prompt || DEFAULT_HEARTBEAT_PROMPT;

    // Try to load HEARTBEAT.md
    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    let heartbeatContext = '';

    try {
      const file = Bun.file(heartbeatMdPath);
      if (await file.exists()) {
        const content = await file.text();
        // Skip if file is empty or only has whitespace/headers
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

  /**
   * Display heartbeat result in terminal
   */
  private async displayResult(result: HeartbeatResult): Promise<void> {
    const visibility = this.config.visibility || {};

    if (result.type === 'ok') {
      // Show OK status
      const showOk = visibility.showOk ?? false;
      if (showOk || result.content) {
        step.heartbeatResult(true);
      } else {
        // Suppress OK output - just show muted result
        console.log(`  ${colors.muted}⎿  OK${colors.reset}`);
      }
    } else if (result.type === 'alert') {
      // Show alert content
      const showAlerts = visibility.showAlerts ?? true;
      if (showAlerts && result.content) {
        const lines = result.content.split('\n').slice(0, 5);
        const preview = lines.join(' ').slice(0, 100);
        console.log(`  ${colors.warning}⎿  ${preview}${lines.length > 5 ? '...' : ''}${colors.reset}`);
      }
      step.heartbeatResult(false);
    }
  }

  /**
   * Route alert to appropriate connectors
   */
  private async routeAlert(result: HeartbeatResult): Promise<void> {
    const target = result.target;

    if (target === 'none') return;

    const alertMessage = `[HEARTBEAT ALERT]\n${result.content}`;

    if (target === 'telegram' || target === 'discord') {
      // Send to specific connector
      step.connector(target, 'send');
      const result = await this.connectorRegistry.notify(alertMessage, target);
      if (result.sent.length === 0) {
        step.error(`Failed to send to ${target}`);
      }
    }
    // 'cli' target just displays in terminal (already done)
  }

  /**
   * Get next scheduled heartbeat time
   */
  getNextHeartbeat(): Date | null {
    if (!this.config.enabled || !this.running) return null;

    const intervalMs = parseDuration(this.config.every || '30m');
    const lastRun = this.state.lastRun ? new Date(this.state.lastRun) : new Date();

    return new Date(lastRun.getTime() + intervalMs);
  }

  /**
   * Get service status
   */
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
      interval: this.config.every || '30m',
      nextRun: next ? this.formatRelativeTime(next) : null,
      lastRun: this.state.lastRun
        ? this.formatRelativeTime(new Date(this.state.lastRun))
        : null,
      consecutiveOks: this.state.consecutiveOks,
      totalRuns: this.state.totalRuns,
      totalAlerts: this.state.totalAlerts,
    };
  }

  /**
   * Format a date as relative time
   */
  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const absDiff = Math.abs(diff);

    const minutes = Math.floor(absDiff / 60000);
    const hours = Math.floor(minutes / 60);

    if (diff < 0) {
      // Past
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
      return date.toLocaleDateString();
    } else {
      // Future
      if (minutes < 1) return 'now';
      if (minutes < 60) return `in ${minutes}m`;
      if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
      return date.toLocaleDateString();
    }
  }

  /**
   * Update HEARTBEAT.md file
   */
  async updateHeartbeatMd(content: string): Promise<void> {
    const heartbeatMdPath = `${this.workDir}/HEARTBEAT.md`;
    await Bun.write(heartbeatMdPath, content);
  }

  /**
   * Read HEARTBEAT.md file
   */
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

/**
 * Factory function for DI
 */
export function createHeartbeatService(
  eventBus: EventBus,
  connectorRegistry: ConnectorRegistry,
): HeartbeatService {
  return new HeartbeatService(eventBus, connectorRegistry);
}
