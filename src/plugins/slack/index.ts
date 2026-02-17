import { promises as fsPromises } from 'node:fs';
import { z } from 'zod';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk/index.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { AuthProfileRouter } from '@slashbot/core/providers/auth-router.js';
import type { ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import { KernelLlmAdapter } from '@slashbot/core/agentic/llm/index.js';
import type { TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/index.js';
import { ConnectorAgentSession, SessionChatHistoryStore } from '../services/connector-agent.js';
import { PreemptiveQueue } from '../services/preemptive-queue.js';
import type { TranscriptionService } from '../services/transcription-service.js';
import { asObject, asString, splitMessage } from '../utils.js';
import type { AgentRegistry } from '../agents/index.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'connector:slack:status': { status: string };
    'connector:slack:message': { chatId: string; text: string };
  }
}

const PLUGIN_ID = 'slashbot.channel.slack';

type ConnectorStatus = 'connected' | 'busy' | 'disconnected';

const SlackConfigSchema = z.object({
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  authorizedUserIds: z.array(z.string()).default([]),
});

interface SlackConfig {
  botToken?: string;
  appToken?: string;
  authorizedUserIds: string[];
}

const VOICE_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a', '.webm'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function parseAgentRouting(text: string): { agentId?: string; message: string } {
  const match = text.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
  if (match) return { agentId: match[1].toLowerCase(), message: match[2].trim() };
  return { message: text };
}

/**
 * Slack Channel plugin — Socket Mode connector with context-aware agents.
 *
 * Handles DMs, channel messages, threaded replies, file attachments, and voice transcription.
 * Uses @slack/bolt for Socket Mode, Events API, and slash commands.
 *
 * Dependencies: transcription, providers.auth, agentic.tools
 *
 * Tools:
 *  - `slack.status`       — Get connector status.
 *  - `slack.send`         — Send a message to a Slack channel/thread.
 *  - `slack.add_user`     — Authorize a user for interaction.
 *  - `slack.remove_user`  — Remove a user authorization.
 *
 * Commands:
 *  - `/slack status`      — Show connector status.
 *  - `/slack setup`       — Save bot/app tokens.
 *
 * Services:
 *  - `connector.slack.status` — Status getter for TUI.
 *
 * Channels:
 *  - `slack` — Outbound message transport.
 *
 * Hooks:
 *  - `slack.startup`  — Load config, connect Socket Mode.
 *  - `slack.shutdown` — Disconnect.
 *
 * HTTP routes:
 *  - `POST /slack/events` — Webhook fallback.
 */
export function createSlackPlugin(): SlashbotPlugin {
  let app: import('@slack/bolt').App | null = null;
  let status: ConnectorStatus = 'disconnected';
  let updateIndicatorStatus: ((s: ConnectorStatus) => void) | null = null;
  let agentSession: ConnectorAgentSession | null = null;
  let slackConfig: SlackConfig = { authorizedUserIds: [] };
  let botUserId = '';

  let homeDir = '';
  let configPath = '';
  let lockPath = '';

  async function loadConfig(): Promise<void> {
    try {
      const data = await fsPromises.readFile(configPath, 'utf8');
      const result = SlackConfigSchema.safeParse(JSON.parse(data));
      if (result.success) {
        slackConfig = { ...slackConfig, ...result.data };
      }
    } catch { /* use defaults */ }
  }

  async function saveConfig(): Promise<void> {
    await fsPromises.mkdir(homeDir, { recursive: true });
    await fsPromises.writeFile(configPath, JSON.stringify(slackConfig, null, 2), 'utf8');
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

  function isAuthorizedUser(userId: string): boolean {
    if (slackConfig.authorizedUserIds.length === 0) return true;
    return slackConfig.authorizedUserIds.includes(userId);
  }

  function stripBotMention(text: string): string {
    if (!botUserId) return text;
    return text.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
  }

  function parseChatId(channelId: string, threadTs?: string): string {
    return threadTs ? `${channelId}/${threadTs}` : channelId;
  }

  function parseSessionId(chatId: string): string {
    return `sl-${chatId.replace('/', '-')}`;
  }

  /** Download a Slack file using the bot token for auth. */
  async function downloadSlackFile(url: string, token: string): Promise<Buffer | null> {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Slack Channel',
      version: '0.1.0',
      main: 'bundled',
      description: 'Slack Socket Mode connector with context-aware agents',
      dependencies: ['slashbot.transcription', 'slashbot.providers.auth', 'slashbot.agentic.tools'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const paths = context.getService<PathResolver>('kernel.paths')!;

      homeDir = paths.home();
      configPath = paths.home('slack.json');
      lockPath = paths.home('slack.lock');

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
          new SessionChatHistoryStore(paths.home('sessions')),
        );
      }

      const queue = new PreemptiveQueue();

      // ── Status service ─────────────────────────────────────────────

      context.registerService({
        id: 'connector.slack.status',
        pluginId: PLUGIN_ID,
        description: 'Slack connector status getter',
        implementation: { getStatus: () => status },
      });

      updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.slack',
        pluginId: PLUGIN_ID,
        label: 'Slack',
        kind: 'connector',
        priority: 25,
        statusEvent: 'connector:slack:status',
        showActivity: true,
        connectorName: 'slack',
        getInitialStatus: () => status,
      });

      // ── Channel ────────────────────────────────────────────────────

      context.registerChannel({
        id: 'slack',
        pluginId: PLUGIN_ID,
        description: 'Slack channel transport',
        connector: true,
        sessionPrefix: 'sl-',
        send: async (payload) => {
          if (!app) {
            logger.warn('Slack: cannot send — no app connected');
            return;
          }
          const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          // Payload can be { chatId, content } for targeted sends
          const obj = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
          const targetChatId = typeof obj?.chatId === 'string' ? obj.chatId : undefined;
          const content = typeof obj?.content === 'string' ? obj.content : text;

          if (!targetChatId) {
            logger.warn('Slack: cannot send — no target chatId');
            return;
          }

          const [channelId, threadTs] = targetChatId.split('/');
          const parts = splitMessage(content, 4000);
          for (const part of parts) {
            await app.client.chat.postMessage({
              channel: channelId,
              text: part,
              ...(threadTs ? { thread_ts: threadTs } : {}),
            });
          }
        },
      });

      // ── Tools ──────────────────────────────────────────────────────

      context.registerTool({
        id: 'slack.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get Slack connector status. Args: {}',
        execute: async () => ({
          ok: true,
          output: {
            status,
            authorizedUsers: slackConfig.authorizedUserIds.length,
          } as unknown as JsonValue,
        }),
      });

      context.registerTool({
        id: 'slack.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send a message to a Slack channel. Args: { channelId: string, text: string, threadTs?: string }',
        parameters: z.object({
          channelId: z.string().describe('Target Slack channel ID'),
          text: z.string().describe('Message text to send'),
          threadTs: z.string().optional().describe('Thread timestamp to reply in thread'),
        }),
        execute: async (args) => {
          try {
            if (!app) return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Slack bot not connected' } };
            const input = asObject(args);
            const channelId = asString(input.channelId, 'channelId');
            const text = asString(input.text, 'text');
            const threadTs = typeof input.threadTs === 'string' ? input.threadTs : undefined;
            const parts = splitMessage(text, 4000);
            for (const part of parts) {
              await app.client.chat.postMessage({
                channel: channelId,
                text: part,
                ...(threadTs ? { thread_ts: threadTs } : {}),
              });
            }
            return { ok: true, output: 'sent' };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'slack.add_user',
        title: 'Authorize User',
        pluginId: PLUGIN_ID,
        description: 'Authorize a Slack user for interaction. Args: { userId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const userId = asString(input.userId, 'userId');
            if (!slackConfig.authorizedUserIds.includes(userId)) {
              slackConfig.authorizedUserIds.push(userId);
              await saveConfig();
            }
            return { ok: true, output: `User ${userId} authorized` };
          } catch (err) {
            return { ok: false, error: { code: 'ADD_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'slack.remove_user',
        title: 'Revoke User',
        pluginId: PLUGIN_ID,
        description: 'Remove a Slack user authorization. Args: { userId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const userId = asString(input.userId, 'userId');
            slackConfig.authorizedUserIds = slackConfig.authorizedUserIds.filter((id) => id !== userId);
            await saveConfig();
            return { ok: true, output: `User ${userId} removed` };
          } catch (err) {
            return { ok: false, error: { code: 'REMOVE_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ───────────────────────────────────────────────────

      context.registerCommand({
        id: 'slack',
        pluginId: PLUGIN_ID,
        description: 'Slack connector status and management',
        subcommands: ['status', 'setup'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(`Status: ${status}\nAuthorized users: ${slackConfig.authorizedUserIds.join(', ') || 'all (no allowlist)'}\n`);
            return 0;
          }

          if (sub === 'setup') {
            const botToken = args[1] ?? process.env.SLACK_BOT_TOKEN;
            const appToken = args[2] ?? process.env.SLACK_APP_TOKEN;
            if (!botToken || !appToken) {
              commandContext.stderr.write('Usage: slack setup <bot-token> <app-token> or set SLACK_BOT_TOKEN + SLACK_APP_TOKEN env\n');
              return 1;
            }
            slackConfig.botToken = botToken;
            slackConfig.appToken = appToken;
            await saveConfig();
            commandContext.stdout.write('Slack tokens saved. Restart to connect.\n');
            return 0;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── Gateway method ─────────────────────────────────────────────

      context.registerGatewayMethod({
        id: 'slack.send',
        pluginId: PLUGIN_ID,
        description: 'Send payload to Slack channel via RPC',
        handler: async (params) => {
          if (!app) return { ok: false, error: 'not connected' } as unknown as JsonValue;
          const obj = typeof params === 'object' && params !== null && !Array.isArray(params) ? params as Record<string, unknown> : null;
          const channelId = typeof obj?.channelId === 'string' ? obj.channelId : undefined;
          const text = typeof obj?.text === 'string' ? obj.text : typeof params === 'string' ? params : JSON.stringify(params);
          if (!channelId) return { ok: false, error: 'no channelId' } as unknown as JsonValue;
          const parts = splitMessage(text, 4000);
          for (const part of parts) {
            await app.client.chat.postMessage({ channel: channelId, text: part });
          }
          return { ok: true } as unknown as JsonValue;
        },
      });

      // ── HTTP webhook fallback ──────────────────────────────────────

      context.registerHttpRoute({
        method: 'POST',
        path: '/slack/events',
        pluginId: PLUGIN_ID,
        description: 'Slack events webhook fallback',
        handler: async (req, res) => {
          let body = '';
          for await (const chunk of req) { body += String(chunk); }

          // Handle Slack URL verification challenge
          try {
            const parsed = JSON.parse(body);
            if (parsed.type === 'url_verification') {
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ challenge: parsed.challenge }));
              return;
            }
          } catch { /* not JSON */ }

          logger.info('Slack webhook received', { bodyLength: body.length });
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":true}\n');
        },
      });

      // ── Startup hook ───────────────────────────────────────────────

      context.registerHook({
        id: 'slack.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        handler: async () => {
          await loadConfig();
          const botToken = slackConfig.botToken ?? process.env.SLACK_BOT_TOKEN;
          const appToken = slackConfig.appToken ?? process.env.SLACK_APP_TOKEN;
          if (!botToken || !appToken) {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:slack:status', { status: 'disconnected' });
            return;
          }
          status = 'busy';
          updateIndicatorStatus?.('busy');
          kernel?.events.publish('connector:slack:status', { status: 'busy' });

          void (async () => {
            const locked = await acquireLock();
            if (!locked) {
              status = 'busy';
              updateIndicatorStatus?.('busy');
              kernel?.events.publish('connector:slack:status', { status: 'busy' });
              logger.info('Slack locked by another instance');
              return;
            }

            try {
              const { App } = await import('@slack/bolt');
              app = new App({
                token: botToken,
                appToken,
                socketMode: true,
              });

              const transcription = context.getService<TranscriptionService>('transcription.service');

              // Get bot user ID for mention stripping
              try {
                const authResult = await app.client.auth.test();
                botUserId = (authResult.user_id as string) ?? '';
              } catch { /* non-fatal */ }

              // Handle all messages
              app.message(async ({ message, say, client }) => {
                // Type narrowing for GenericMessageEvent
                const msg = message as { user?: string; bot_id?: string; text?: string; thread_ts?: string; ts?: string; channel?: string; files?: Array<{ url_private?: string; name?: string; mimetype?: string }> };
                if (!msg.user || msg.bot_id) return;
                if (!isAuthorizedUser(msg.user)) return;
                if (!agentSession) return;

                const channelId = msg.channel ?? '';
                const threadTs = msg.thread_ts;
                const messageTs = msg.ts ?? '';
                const chatId = parseChatId(channelId, threadTs);
                const sessionId = parseSessionId(chatId);

                // Add eyes reaction to indicate processing
                try {
                  await client.reactions.add({
                    channel: channelId,
                    timestamp: messageTs,
                    name: 'eyes',
                  });
                } catch { /* non-fatal */ }

                // Process images (before enqueue — fast, no LLM call)
                const images: string[] = [];
                if (msg.files) {
                  for (const file of msg.files) {
                    if (!file.url_private || !file.name) continue;
                    const ext = `.${file.name.toLowerCase().split('.').pop() ?? ''}`;
                    if (IMAGE_EXTENSIONS.includes(ext) || (file.mimetype?.startsWith('image/') ?? false)) {
                      const buf = await downloadSlackFile(file.url_private, botToken);
                      if (buf) {
                        const mimeType = file.mimetype ?? 'image/png';
                        images.push(`data:${mimeType};base64,${buf.toString('base64')}`);
                      }
                    }
                  }
                }

                // Process voice files
                let voiceText = '';
                if (transcription && msg.files) {
                  for (const file of msg.files) {
                    if (!file.url_private || !file.name) continue;
                    const ext = `.${file.name.toLowerCase().split('.').pop() ?? ''}`;
                    if (VOICE_EXTENSIONS.includes(ext)) {
                      try {
                        const buf = await downloadSlackFile(file.url_private, botToken);
                        if (buf) {
                          const { text: transcribed } = await transcription.transcribe(buf, file.name);
                          voiceText += ` ${transcribed}`;
                        }
                      } catch { /* skip voice */ }
                    }
                  }
                }

                let rawText = stripBotMention(msg.text ?? '');
                rawText = (rawText + voiceText).trim() || (images.length > 0 ? 'What is in this image?' : '');
                if (!rawText) return;

                // Parse @agent routing
                const routing = parseAgentRouting(rawText);
                if (routing.agentId) {
                  const agentRegistry = context.getService<AgentRegistry>('agents.registry');
                  if (agentRegistry) {
                    const agent = agentRegistry.get(routing.agentId);
                    if (!agent) {
                      await say({ text: `Unknown agent: @${routing.agentId}. Use agents.list to see available agents.`, ...(threadTs || messageTs ? { thread_ts: threadTs || messageTs } : {}) });
                      return;
                    }
                  }
                }

                kernel?.events.publish('connector:slack:message', { chatId, text: routing.message });

                queue.enqueue(chatId, async (signal) => {
                  try {
                    const response = await agentSession!.chat(chatId, routing.message, {
                      sessionId,
                      agentId: routing.agentId ?? 'default-agent',
                      images: images.length > 0 ? images : undefined,
                      abortSignal: signal,
                    });

                    if (signal.aborted) return;

                    const parts = splitMessage(response, 4000);
                    for (const part of parts) {
                      await say({ text: part, ...(threadTs || messageTs ? { thread_ts: threadTs || messageTs } : {}) });
                    }

                    // Add checkmark reaction to indicate success
                    try {
                      await client.reactions.add({
                        channel: channelId,
                        timestamp: messageTs,
                        name: 'white_check_mark',
                      });
                    } catch { /* non-fatal */ }
                  } catch (err) {
                    if (signal.aborted) return;
                    logger.error('Slack message handler error', { error: String(err) });
                    await say({ text: 'An error occurred processing your message.', ...(threadTs || messageTs ? { thread_ts: threadTs || messageTs } : {}) }).catch(() => {});
                  }
                });
              });

              // Handle app mentions (in channels where the bot is @mentioned)
              app.event('app_mention', async ({ event, say, client }) => {
                const ev = event as { user?: string; text?: string; ts?: string; thread_ts?: string; channel?: string };
                if (!ev.user || !isAuthorizedUser(ev.user)) return;
                if (!agentSession) return;

                const channelId = ev.channel ?? '';
                const threadTs = ev.thread_ts;
                const messageTs = ev.ts ?? '';
                const chatId = parseChatId(channelId, threadTs);
                const sessionId = parseSessionId(chatId);

                try {
                  await client.reactions.add({ channel: channelId, timestamp: messageTs, name: 'eyes' });
                } catch { /* non-fatal */ }

                const rawText = stripBotMention(ev.text ?? '').trim();
                if (!rawText) return;

                const routing = parseAgentRouting(rawText);

                queue.enqueue(chatId, async (signal) => {
                  try {
                    const response = await agentSession!.chat(chatId, routing.message, {
                      sessionId,
                      agentId: routing.agentId ?? 'default-agent',
                      abortSignal: signal,
                    });

                    if (signal.aborted) return;

                    const parts = splitMessage(response, 4000);
                    for (const part of parts) {
                      await say({ text: part, ...(threadTs || messageTs ? { thread_ts: threadTs || messageTs } : {}) });
                    }

                    try {
                      await client.reactions.add({ channel: channelId, timestamp: messageTs, name: 'white_check_mark' });
                    } catch { /* non-fatal */ }
                  } catch (err) {
                    if (signal.aborted) return;
                    logger.error('Slack app_mention handler error', { error: String(err) });
                    await say({ text: 'An error occurred processing your message.', ...(threadTs || messageTs ? { thread_ts: threadTs || messageTs } : {}) }).catch(() => {});
                  }
                });
              });

              await app.start();
              status = 'connected';
              updateIndicatorStatus?.('connected');
              kernel?.events.publish('connector:slack:status', { status: 'connected' });
              logger.info('Slack bot connected via Socket Mode');
            } catch (err) {
              status = 'disconnected';
              updateIndicatorStatus?.('disconnected');
              kernel?.events.publish('connector:slack:status', { status: 'disconnected' });
              logger.error('Slack bot launch failed', { error: String(err) });
              await releaseLock();
            }
          })().catch((err) => {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:slack:status', { status: 'disconnected' });
            logger.error('Slack async startup failed', { error: String(err) });
          });
        },
      });

      // ── Shutdown hook ──────────────────────────────────────────────

      context.registerHook({
        id: 'slack.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          queue.shutdown();
          if (app) {
            await app.stop();
            app = null;
          }
          status = 'disconnected';
          updateIndicatorStatus?.('disconnected');
          kernel?.events.publish('connector:slack:status', { status: 'disconnected' });
          await releaseLock();
        },
      });
    },
  };
}

export { createSlackPlugin as createPlugin };
