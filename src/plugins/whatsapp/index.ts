import { promises as fsPromises } from 'node:fs';
import { z } from 'zod';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '@slashbot/plugin-sdk';
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { AuthProfileRouter } from '../../core/providers/auth-router.js';
import type { ProviderRegistry } from '../../core/kernel/registries.js';
import { KernelLlmAdapter } from '../../core/agentic/llm/index.js';
import type { TokenModeProxyAuthService } from '../../core/agentic/llm/index.js';
import { ConnectorAgentSession } from '../services/connector-agent.js';
import type { TranscriptionService } from '../services/transcription-service.js';
import { asObject, asString, splitMessage } from '../utils.js';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'connector:whatsapp:status': { status: string };
    'connector:whatsapp:message': { chatId: string; text: string };
  }
}

const PLUGIN_ID = 'slashbot.channel.whatsapp';

type ConnectorStatus = 'connected' | 'busy' | 'disconnected';

const WhatsAppConfigSchema = z.object({
  bridgeUrl: z.string().optional(),
  authorizedPhoneNumbers: z.array(z.string()).default([]),
});

interface WhatsAppConfig {
  bridgeUrl?: string;
  authorizedPhoneNumbers: string[];
}

interface BridgeMessage {
  type: string;
  from?: string;
  from_name?: string;
  chat?: string;
  content?: string;
  media?: string[];
  id?: string;
}

const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a', '.webm', '.opus'];

/**
 * WhatsApp Channel plugin — WebSocket bridge connector with context-aware agents.
 *
 * Connects to an external WhatsApp bridge (e.g., whatsapp-web.js or Baileys)
 * via WebSocket. Handles text messages, media, and voice transcription.
 *
 * Dependencies: transcription, providers.auth, agentic.tools
 *
 * Tools:
 *  - `whatsapp.status` — Get connector status.
 *  - `whatsapp.send`   — Send a message via the WhatsApp bridge.
 *
 * Commands:
 *  - `/whatsapp status` — Show connector status.
 *  - `/whatsapp setup`  — Save bridge URL.
 *
 * Services:
 *  - `connector.whatsapp.status` — Status getter for TUI.
 *
 * Channels:
 *  - `whatsapp` — Outbound message transport.
 *
 * Hooks:
 *  - `whatsapp.startup`  — Load config, connect WebSocket.
 *  - `whatsapp.shutdown` — Disconnect.
 */
export function createWhatsAppPlugin(): SlashbotPlugin {
  let ws: import('ws').WebSocket | null = null;
  let status: ConnectorStatus = 'disconnected';
  let updateIndicatorStatus: ((s: ConnectorStatus) => void) | null = null;
  let agentSession: ConnectorAgentSession | null = null;
  let waConfig: WhatsAppConfig = { authorizedPhoneNumbers: [] };
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let shouldReconnect = false;

  let homeDir = '';
  let configPath = '';
  let lockPath = '';

  async function loadConfig(): Promise<void> {
    try {
      const data = await fsPromises.readFile(configPath, 'utf8');
      const result = WhatsAppConfigSchema.safeParse(JSON.parse(data));
      if (result.success) {
        waConfig = { ...waConfig, ...result.data };
      }
    } catch { /* use defaults */ }
  }

  async function saveConfig(): Promise<void> {
    await fsPromises.mkdir(homeDir, { recursive: true });
    await fsPromises.writeFile(configPath, JSON.stringify(waConfig, null, 2), 'utf8');
  }

  async function acquireLock(): Promise<boolean> {
    try {
      await fsPromises.mkdir(homeDir, { recursive: true });
      await fsPromises.writeFile(lockPath, `${process.pid}`, { flag: 'wx' });
      return true;
    } catch {
      try {
        const pid = await fsPromises.readFile(lockPath, 'utf8');
        try { process.kill(Number(pid), 0); return false; } catch { /* stale lock */ }
        await fsPromises.unlink(lockPath);
        await fsPromises.writeFile(lockPath, `${process.pid}`, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function releaseLock(): Promise<void> {
    try { await fsPromises.unlink(lockPath); } catch { /* ok */ }
  }

  function isAuthorizedSender(from: string): boolean {
    if (waConfig.authorizedPhoneNumbers.length === 0) return true;
    return waConfig.authorizedPhoneNumbers.includes(from);
  }

  function sendToWs(data: Record<string, unknown>): void {
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(data));
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot WhatsApp Channel',
      version: '0.1.0',
      main: 'bundled',
      description: 'WhatsApp WebSocket bridge connector with context-aware agents',
      dependencies: ['slashbot.transcription', 'slashbot.providers.auth', 'slashbot.agentic.tools'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const paths = context.getService<PathResolver>('kernel.paths')!;

      homeDir = paths.home();
      configPath = paths.home('whatsapp.json');
      lockPath = paths.home('whatsapp.lock');

      // Build agent session
      if (authRouter && providers && kernel) {
        const llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
        agentSession = new ConnectorAgentSession(
          llm,
          () => kernel.assemblePrompt(),
          homeDir,
        );
      }

      // ── Status service ─────────────────────────────────────────────

      context.registerService({
        id: 'connector.whatsapp.status',
        pluginId: PLUGIN_ID,
        description: 'WhatsApp connector status getter',
        implementation: { getStatus: () => status },
      });

      updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.whatsapp',
        pluginId: PLUGIN_ID,
        label: 'WhatsApp',
        kind: 'connector',
        priority: 30,
        statusEvent: 'connector:whatsapp:status',
        showActivity: true,
        connectorName: 'whatsapp',
        getInitialStatus: () => status,
      });

      // ── Channel ────────────────────────────────────────────────────

      context.registerChannel({
        id: 'whatsapp',
        pluginId: PLUGIN_ID,
        description: 'WhatsApp channel transport',
        connector: true,
        sessionPrefix: 'wa-',
        send: async (payload) => {
          if (!ws || ws.readyState !== ws.OPEN) {
            logger.warn('WhatsApp: cannot send — not connected');
            return;
          }
          const obj = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
          const chatId = typeof obj?.chatId === 'string' ? obj.chatId : undefined;
          const content = typeof obj?.content === 'string' ? obj.content : (typeof payload === 'string' ? payload : JSON.stringify(payload));
          if (!chatId) {
            logger.warn('WhatsApp: cannot send — no target chatId');
            return;
          }
          const parts = splitMessage(content, 4096);
          for (const part of parts) {
            sendToWs({ type: 'message', to: chatId, content: part });
          }
        },
      });

      // ── Tools ──────────────────────────────────────────────────────

      context.registerTool({
        id: 'whatsapp.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get WhatsApp connector status. Args: {}',
        execute: async () => ({
          ok: true,
          output: {
            status,
            bridgeUrl: waConfig.bridgeUrl ?? null,
            authorizedNumbers: waConfig.authorizedPhoneNumbers.length,
          } as unknown as JsonValue,
        }),
      });

      context.registerTool({
        id: 'whatsapp.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send a message via WhatsApp bridge. Args: { chatId: string, text: string }',
        parameters: z.object({
          chatId: z.string().describe('Target WhatsApp chat ID (phone number or group ID)'),
          text: z.string().describe('Message text to send'),
        }),
        execute: async (args) => {
          try {
            if (!ws || ws.readyState !== ws.OPEN) return { ok: false, error: { code: 'NOT_CONNECTED', message: 'WhatsApp bridge not connected' } };
            const input = asObject(args);
            const chatId = asString(input.chatId, 'chatId');
            const text = asString(input.text, 'text');
            const parts = splitMessage(text, 4096);
            for (const part of parts) {
              sendToWs({ type: 'message', to: chatId, content: part });
            }
            return { ok: true, output: 'sent' };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ───────────────────────────────────────────────────

      context.registerCommand({
        id: 'whatsapp',
        pluginId: PLUGIN_ID,
        description: 'WhatsApp connector status and management',
        subcommands: ['status', 'setup'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(`Status: ${status}\nBridge URL: ${waConfig.bridgeUrl ?? 'not set'}\nAuthorized: ${waConfig.authorizedPhoneNumbers.join(', ') || 'all (no allowlist)'}\n`);
            return 0;
          }

          if (sub === 'setup') {
            const url = args[1] ?? process.env.WHATSAPP_BRIDGE_URL;
            if (!url) {
              commandContext.stderr.write('Usage: whatsapp setup <bridge-url> or set WHATSAPP_BRIDGE_URL env\n');
              return 1;
            }
            waConfig.bridgeUrl = url;
            await saveConfig();
            commandContext.stdout.write('WhatsApp bridge URL saved. Restart to connect.\n');
            return 0;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── WebSocket connection with reconnection ─────────────────────

      function scheduleReconnect(): void {
        if (!shouldReconnect) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempt), 60_000);
        reconnectAttempt++;
        logger.info('WhatsApp: scheduling reconnect', { delay, attempt: reconnectAttempt });
        reconnectTimer = setTimeout(() => void connectWs(), delay);
      }

      async function connectWs(): Promise<void> {
        const bridgeUrl = waConfig.bridgeUrl ?? process.env.WHATSAPP_BRIDGE_URL;
        if (!bridgeUrl) return;

        try {
          const WebSocket = (await import('ws')).default;
          ws = new WebSocket(bridgeUrl);

          const transcription = context.getService<TranscriptionService>('transcription.service');

          ws.on('open', () => {
            reconnectAttempt = 0;
            status = 'connected';
            updateIndicatorStatus?.('connected');
            kernel?.events.publish('connector:whatsapp:status', { status: 'connected' });
            logger.info('WhatsApp bridge connected');
          });

          ws.on('message', (data) => {
            void (async () => {
              try {
                const raw = typeof data === 'string' ? data : data.toString('utf8');
                const msg: BridgeMessage = JSON.parse(raw);

                if (msg.type !== 'message') return;
                if (!msg.from) return;
                if (!isAuthorizedSender(msg.from)) return;
                if (!agentSession) return;

                const chatId = msg.chat ?? msg.from;
                const sessionId = `wa-${chatId}`;

                // Process audio media for transcription
                let voiceText = '';
                if (transcription && msg.media) {
                  for (const mediaPath of msg.media) {
                    const ext = `.${mediaPath.toLowerCase().split('.').pop() ?? ''}`;
                    if (AUDIO_EXTENSIONS.includes(ext)) {
                      try {
                        const { text: transcribed } = await transcription.transcribeFromUrl(mediaPath);
                        voiceText += ` ${transcribed}`;
                      } catch { /* skip */ }
                    }
                  }
                }

                const text = ((msg.content ?? '') + voiceText).trim();
                if (!text) return;

                kernel?.events.publish('connector:whatsapp:message', { chatId, text });

                const response = await agentSession.chat(chatId, text, {
                  sessionId,
                  agentId: 'default-agent',
                });

                const parts = splitMessage(response, 4096);
                for (const part of parts) {
                  sendToWs({ type: 'message', to: chatId, content: part });
                }
              } catch (err) {
                logger.error('WhatsApp message handler error', { error: String(err) });
              }
            })();
          });

          ws.on('close', () => {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:whatsapp:status', { status: 'disconnected' });
            ws = null;
            scheduleReconnect();
          });

          ws.on('error', (err) => {
            logger.error('WhatsApp WebSocket error', { error: String(err) });
            ws?.close();
          });
        } catch (err) {
          logger.error('WhatsApp connection failed', { error: String(err) });
          scheduleReconnect();
        }
      }

      // ── Startup hook ───────────────────────────────────────────────

      context.registerHook({
        id: 'whatsapp.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        handler: async () => {
          await loadConfig();
          const bridgeUrl = waConfig.bridgeUrl ?? process.env.WHATSAPP_BRIDGE_URL;
          if (!bridgeUrl) {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:whatsapp:status', { status: 'disconnected' });
            return;
          }
          status = 'busy';
          updateIndicatorStatus?.('busy');
          kernel?.events.publish('connector:whatsapp:status', { status: 'busy' });

          void (async () => {
            const locked = await acquireLock();
            if (!locked) {
              status = 'busy';
              updateIndicatorStatus?.('busy');
              kernel?.events.publish('connector:whatsapp:status', { status: 'busy' });
              logger.info('WhatsApp locked by another instance');
              return;
            }
            shouldReconnect = true;
            await connectWs();
          })().catch((err) => {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:whatsapp:status', { status: 'disconnected' });
            logger.error('WhatsApp async startup failed', { error: String(err) });
          });
        },
      });

      // ── Shutdown hook ──────────────────────────────────────────────

      context.registerHook({
        id: 'whatsapp.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          shouldReconnect = false;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          if (ws) {
            ws.close();
            ws = null;
          }
          status = 'disconnected';
          updateIndicatorStatus?.('disconnected');
          kernel?.events.publish('connector:whatsapp:status', { status: 'disconnected' });
          await releaseLock();
        },
      });
    },
  };
}

export { createWhatsAppPlugin as createPlugin };
