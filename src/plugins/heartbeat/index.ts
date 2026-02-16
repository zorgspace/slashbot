import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { IndicatorStatus, JsonValue, SlashbotPlugin, StructuredLogger } from '../../core/kernel/contracts.js';

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
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { EventBus } from '../../core/kernel/event-bus.js';
import type { ChannelRegistry, ProviderRegistry } from '../../core/kernel/registries.js';
import type { LlmAdapter } from '../../core/agentic/llm/index.js';
import { KernelLlmAdapter } from '../../core/agentic/llm/index.js';
import type { TokenModeProxyAuthService } from '../../core/agentic/llm/index.js';
import type { AuthProfileRouter } from '../../core/providers/auth-router.js';
import { asObject } from '../utils.js';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'heartbeat:status': { status: string };
    'heartbeat:started': Record<string, never>;
    'heartbeat:complete': { result: JsonValue; responseLength: number };
    'heartbeat:error': { error: string };
  }
}

const PLUGIN_ID = 'slashbot.heartbeat';

interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  prompt: string;
  deliveryConnectors: string[];
}

interface HeartbeatState {
  totalRuns: number;
  totalAlerts: number;
  lastRunAt?: string;
  lastResult?: 'ok' | 'alert' | 'error';
  lastError?: string;
}

function parseInterval(value: string): number {
  const match = value.match(/^(\d+)\s*(m|min|h|hr|s|sec)?$/i);
  if (!match) return 30 * 60_000; // default 30m
  const num = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  if (unit.startsWith('h')) return num * 60 * 60_000;
  if (unit.startsWith('s')) return num * 1000;
  return num * 60_000;
}

function formatIntervalHuman(ms: number): string {
  if (ms >= 3_600_000) {
    const h = ms / 3_600_000;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (ms >= 60_000) {
    const m = ms / 60_000;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  const s = ms / 1000;
  return s === 1 ? '1 second' : `${s} seconds`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const absDiff = -diff;
    if (absDiff < 60_000) return `in ${Math.round(absDiff / 1000)}s`;
    if (absDiff < 3_600_000) return `in ${Math.round(absDiff / 60_000)}m`;
    return `in ${Math.round(absDiff / 3_600_000)}h`;
  }
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function classifyResponse(response: string): 'ok' | 'alert' | 'warning' {
  const first = response.slice(0, 30).toUpperCase();
  if (first.startsWith('[OK]')) return 'ok';
  if (first.startsWith('[ALERT]')) return 'alert';
  if (first.startsWith('[WARNING]')) return 'warning';
  // Keyword fallback
  if (/\b(error|critical|fail|down|outage)\b/i.test(response)) return 'alert';
  if (/\b(warn|degrad|slow|attention)\b/i.test(response)) return 'warning';
  return 'ok';
}

/**
 * HeartbeatService — periodic LLM reflection engine.
 *
 * Reads HEARTBEAT.md, sends it to the LLM for review, tracks run statistics,
 * and delivers results to configured channels. State is persisted across
 * restarts, intervals can be changed on the fly (with immediate reschedule),
 * and alert classification uses structured LLM prefixes with keyword fallback.
 *
 * Supports configurable intervals (e.g. "30m", "1h"), custom prompts,
 * manual triggers, and human-readable status output.
 */
class HeartbeatService {
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
        ? `${prompt}\n\n## Current HEARTBEAT.md\n${heartbeatContent}`
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
              'You are a heartbeat agent. You have tools available — use them to carry out ' +
              'the tasks described in the HEARTBEAT.md checklist. Execute each item, then ' +
              'report your final status. Begin your final response with exactly one of: ' +
              '[OK], [ALERT], or [WARNING]. Keep the final summary brief — one short paragraph max.',
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

      // Deliver to configured channels
      await this.deliverToConnectors(response, result);

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

// ── Plugin factory ──────────────────────────────────────────────────────

/**
 * Heartbeat plugin — periodic LLM reflection via HEARTBEAT.md.
 *
 * Runs scheduled heartbeat checks that read HEARTBEAT.md, send its content
 * to the LLM for review, and optionally deliver results to configured channels
 * (Telegram, Discord, etc.). State (run counts, last result) is persisted to
 * disk and restored on restart. Alert classification uses structured LLM
 * prefixes ([OK]/[ALERT]/[WARNING]) with keyword fallback.
 *
 * Dependencies: providers.auth
 *
 * Tools:
 *  - `heartbeat.trigger` — Run a heartbeat check immediately.
 *  - `heartbeat.update`  — Write new content to HEARTBEAT.md.
 *  - `heartbeat.status`  — Get heartbeat config, state, and run statistics.
 *
 * Commands:
 *  - `/heartbeat status`              — Show human-readable config and run state.
 *  - `/heartbeat enable`              — Enable periodic heartbeat checks.
 *  - `/heartbeat disable`             — Disable periodic heartbeat checks.
 *  - `/heartbeat every <interval>`    — Set check interval (e.g. "30m", "1h", "60s").
 *  - `/heartbeat trigger`             — Run a heartbeat check now.
 *  - `/heartbeat prompt [text]`       — View or set the heartbeat prompt.
 *  - `/heartbeat deliver <connector>`   — Add a delivery connector (cli, telegram, discord).
 *  - `/heartbeat undeliver <connector>` — Remove a delivery connector.
 *
 * Services:
 *  - `heartbeat.service` — HeartbeatService instance.
 *
 * Hooks:
 *  - `heartbeat.startup`  — Load config/state and start timer if enabled.
 *  - `heartbeat.shutdown` — Stop heartbeat timer.
 */
export function createHeartbeatPlugin(): SlashbotPlugin {
  let heartbeat: HeartbeatService;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Heartbeat',
      version: '0.1.0',
      main: 'bundled',
      description: 'Periodic LLM reflection via HEARTBEAT.md',
      dependencies: ['slashbot.providers.auth'],
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const events = context.getService<EventBus>('kernel.events');
      const channelsRegistry = context.getService<ChannelRegistry>('kernel.channels.registry');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;

      let llm: LlmAdapter | null = null;
      if (authRouter && providers && kernel) {
        llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
      }

      heartbeat = new HeartbeatService(workspaceRoot, llm, events, channelsRegistry, logger);

      context.registerService({
        id: 'heartbeat.service',
        pluginId: PLUGIN_ID,
        description: 'Periodic heartbeat reflection service',
        implementation: heartbeat,
      });

      const updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.heartbeat',
        pluginId: PLUGIN_ID,
        label: 'Heartbeat',
        kind: 'service',
        priority: 50,
        statusEvent: 'heartbeat:status',
        showActivity: true,
        connectorName: 'heartbeat',
        getInitialStatus: () => {
          const s = heartbeat.getStatus();
          if (!s.enabled) return 'off';
          if (s.running) return 'running';
          const st = heartbeat.getState();
          return st.lastResult === 'error' ? 'error' : 'idle';
        },
      });
      heartbeat.setIndicatorUpdater(updateIndicatorStatus);

      context.registerTool({
        id: 'heartbeat.trigger',
        title: 'Trigger',
        pluginId: PLUGIN_ID,
        description: 'Run a heartbeat check NOW. Use when user says "run heartbeat", "check heartbeat", "trigger heartbeat". Args: { prompt?: string }',
        parameters: z.object({
          prompt: z.string().optional().describe('Custom prompt for this heartbeat run'),
        }),
        execute: async (args) => {
          try {
            const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, JsonValue>) : {};
            const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
            const result = await heartbeat.execute({ prompt, force: true });
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'heartbeat.update',
        title: 'Update',
        pluginId: PLUGIN_ID,
        description: 'Write new content to HEARTBEAT.md. Use when user says "update heartbeat", "set heartbeat content", "write heartbeat". Args: { content: string }',
        parameters: z.object({
          content: z.string().describe('New HEARTBEAT.md content'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const content = typeof input.content === 'string' ? input.content : '';
            await heartbeat.updateHeartbeatMd(content);
            return { ok: true, output: 'HEARTBEAT.md updated' };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_UPDATE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'heartbeat.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get heartbeat config, state, and run stats. Use when user says "heartbeat status", "is heartbeat running". Args: {}',
        parameters: z.object({}),
        execute: async () => {
          const config = heartbeat.getConfig();
          const state = heartbeat.getState();
          const status = heartbeat.getStatus();
          return {
            ok: true,
            output: { config, state, status } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'heartbeat.configure',
        title: 'Configure',
        pluginId: PLUGIN_ID,
        description: 'Enable, disable, or configure the heartbeat timer. Use when user says "enable heartbeat", "start heartbeat every X", "disable heartbeat", "set heartbeat interval". Args: { enabled?: boolean, interval?: string, prompt?: string, deliveryConnector?: "cli"|"telegram"|"discord" }',
        parameters: z.object({
          enabled: z.boolean().optional().describe('Enable or disable heartbeat'),
          interval: z.string().optional().describe('Interval like "1m", "30m", "1h", "60s"'),
          prompt: z.string().optional().describe('Custom heartbeat prompt'),
          deliveryConnector: z.string().optional().describe('Delivery connector: "cli", "telegram", or "discord"'),
        }),
        execute: async (args) => {
          try {
            const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, JsonValue>) : {};
            const results: string[] = [];

            if (typeof input.interval === 'string') {
              await heartbeat.setInterval(input.interval as string);
              results.push(`Interval set to ${input.interval}`);
            }

            if (typeof input.prompt === 'string') {
              await heartbeat.setPrompt(input.prompt as string);
              results.push('Prompt updated');
            }

            if (typeof input.deliveryConnector === 'string') {
              heartbeat.addDeliveryConnector(input.deliveryConnector as string);
              await heartbeat.saveConfig();
              results.push(`Delivery channel added: ${input.deliveryConnector}`);
            }

            if (input.enabled === true) {
              heartbeat.start();
              await heartbeat.saveConfig();
              results.push('Heartbeat enabled');
            } else if (input.enabled === false) {
              heartbeat.stop();
              await heartbeat.saveConfig();
              results.push('Heartbeat disabled');
            }

            if (results.length === 0) {
              return { ok: true, output: heartbeat.formatStatus() };
            }

            return { ok: true, output: results.join('. ') };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_CONFIG_ERROR', message: String(err) } };
          }
        },
      });

      context.registerCommand({
        id: 'heartbeat',
        pluginId: PLUGIN_ID,
        description: 'Heartbeat management (status, enable, disable, every, trigger, prompt, deliver, undeliver)',
        subcommands: ['status', 'enable', 'disable', 'every', 'trigger', 'prompt', 'deliver', 'undeliver'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(`${heartbeat.formatStatus()}\n`);
            return 0;
          }

          if (sub === 'enable') {
            heartbeat.start();
            await heartbeat.saveConfig();
            commandContext.stdout.write('Heartbeat enabled\n');
            return 0;
          }

          if (sub === 'disable') {
            heartbeat.stop();
            await heartbeat.saveConfig();
            commandContext.stdout.write('Heartbeat disabled\n');
            return 0;
          }

          if (sub === 'every' && args[1]) {
            await heartbeat.setInterval(args[1]);
            commandContext.stdout.write(`Heartbeat interval set to: ${args[1]}\n`);
            return 0;
          }

          if (sub === 'trigger') {
            await heartbeat.execute({ force: true });
            return 0;
          }

          if (sub === 'prompt') {
            const text = args.slice(1).join(' ').trim();
            if (!text) {
              commandContext.stdout.write(`Current prompt: ${heartbeat.getConfig().prompt}\n`);
              return 0;
            }
            await heartbeat.setPrompt(text);
            commandContext.stdout.write(`Heartbeat prompt updated\n`);
            return 0;
          }

          if (sub === 'deliver' && args[1]) {
            heartbeat.addDeliveryConnector(args[1]);
            await heartbeat.saveConfig();
            commandContext.stdout.write(`Added delivery connector: ${args[1]}\n`);
            return 0;
          }

          if (sub === 'undeliver' && args[1]) {
            heartbeat.removeDeliveryConnector(args[1]);
            await heartbeat.saveConfig();
            commandContext.stdout.write(`Removed delivery connector: ${args[1]}\n`);
            return 0;
          }

          commandContext.stderr.write(`Unknown heartbeat subcommand: ${sub}\n`);
          return 1;
        },
      });

      // Startup hook
      context.registerHook({
        id: 'heartbeat.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 60,
        handler: async () => {
          await heartbeat.loadConfig();
          await heartbeat.loadState();
          if (heartbeat.getConfig().enabled) {
            heartbeat.start();
          }
        },
      });

      // Shutdown hook
      context.registerHook({
        id: 'heartbeat.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 60,
        handler: () => {
          heartbeat.stop();
        },
      });
    },
  };
}

export { createHeartbeatPlugin as createPlugin };
