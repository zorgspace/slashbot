import { promises as fsPromises } from 'node:fs';
import { z } from 'zod';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '../../core/kernel/contracts.js';

const DiscordConfigSchema = z.object({
  botToken: z.string().optional(),
  authorizedChannelIds: z.array(z.string()).default([]),
  primaryChannelId: z.string().optional(),
  ownerId: z.string().optional(),
});
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { AuthProfileRouter } from '../../core/providers/auth-router.js';
import type { ProviderRegistry } from '../../core/kernel/registries.js';
import { KernelLlmAdapter } from '../../core/agentic/llm/index.js';
import type { TokenModeProxyAuthService } from '../../core/agentic/llm/index.js';
import { ConnectorAgentSession } from '../services/connector-agent.js';
import type { SubagentManager } from '../services/subagent-manager.js';
import type { TranscriptionService } from '../services/transcription-service.js';
import { asObject, asString, splitMessage } from '../utils.js';
import type { AgentRegistry } from '../agents/index.js';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'connector:discord:status': { status: string };
  }
}

const PLUGIN_ID = 'slashbot.channel.discord';

type ConnectorStatus = 'connected' | 'busy' | 'disconnected';

interface DiscordConfig {
  botToken?: string;
  authorizedChannelIds: string[];
  primaryChannelId?: string;
  ownerId?: string;
}

function parseAgentRouting(text: string): { agentId?: string; message: string } {
  const match = text.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
  if (match) return { agentId: match[1].toLowerCase(), message: match[2].trim() };
  return { message: text };
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const VOICE_EXTENSIONS = ['.ogg', '.mp3', '.wav'];

/**
 * Discord Channel plugin — full discord.js connector with context-aware agents.
 *
 * Handles text messages, image attachments, and voice file transcription
 * in authorized Discord channels. Runs an agentic LLM session per channel.
 *
 * Dependencies: transcription, providers.auth, agentic.tools
 *
 * Tools:
 *  - `discord.status`       — Get connector status (connected/disconnected, primary channel).
 *  - `discord.send`         — Send a message to a Discord channel.
 *  - `discord.add_channel`  — Authorize a channel for interaction.
 *  - `discord.remove_channel` — Remove a channel authorization.
 *  - `discord.set_primary`  — Set the primary outbound channel.
 *
 * Commands:
 *  - `/discord status`        — Show connector status and authorized channels.
 *  - `/discord setup <token>` — Save bot token (requires restart to connect).
 *
 * Services:
 *  - `connector.discord.status` — Status getter for TUI.
 *
 * Channels:
 *  - `discord` — Outbound message transport (sends to primary channel).
 *
 * Hooks:
 *  - `discord.startup`  — Load config, acquire lock, login Discord client.
 *  - `discord.shutdown` — Destroy client, release lock.
 *
 * HTTP routes:
 *  - `POST /discord/webhook` — Discord webhook ingress endpoint.
 *
 * Gateway methods:
 *  - `discord.send` — Send payload to discord channel via RPC.
 */
export function createDiscordPlugin(): SlashbotPlugin {
  let client: import('discord.js').Client | null = null;
  let status: ConnectorStatus = 'disconnected';
  let updateIndicatorStatus: ((s: ConnectorStatus) => void) | null = null;
  let agentSession: ConnectorAgentSession | null = null;
  let discordConfig: DiscordConfig = {
    authorizedChannelIds: [],
  };

  let homeDir = '';
  let configPath = '';
  let lockPath = '';

  async function loadConfig(): Promise<void> {
    try {
      const data = await fsPromises.readFile(configPath, 'utf8');
      const result = DiscordConfigSchema.safeParse(JSON.parse(data));
      if (result.success) {
        discordConfig = { ...discordConfig, ...result.data };
      }
    } catch { /* use defaults */ }
  }

  async function saveConfig(): Promise<void> {
    await fsPromises.mkdir(homeDir, { recursive: true });
    await fsPromises.writeFile(configPath, JSON.stringify(discordConfig, null, 2), 'utf8');
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

  function isAuthorized(channelId: string): boolean {
    return discordConfig.authorizedChannelIds.includes(channelId);
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Discord Channel',
      version: '0.1.0',
      main: 'bundled',
      description: 'Full discord.js connector with context-aware agents',
      dependencies: ['slashbot.transcription', 'slashbot.providers.auth', 'slashbot.agentic.tools'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const paths = context.getService<PathResolver>('kernel.paths')!;

      homeDir = paths.home();
      configPath = paths.home('discord.json');
      lockPath = paths.home('discord.lock');

      // Build agent session
      if (authRouter && providers && kernel) {
        const llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
        const getSubagentManager = () => context.getService<SubagentManager>('agentic.subagentManager');
        agentSession = new ConnectorAgentSession(
          llm,
          () => kernel.assemblePrompt(),
          homeDir,
          undefined,
          undefined,
          undefined,
          getSubagentManager,
        );
      }

      // ── Status service (queryable by TUI on mount) ─────────────────

      context.registerService({
        id: 'connector.discord.status',
        pluginId: PLUGIN_ID,
        description: 'Discord connector status getter',
        implementation: { getStatus: () => status },
      });

      updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.discord',
        pluginId: PLUGIN_ID,
        label: 'Discord',
        kind: 'connector',
        priority: 20,
        statusEvent: 'connector:discord:status',
        showActivity: true,
        connectorName: 'discord',
        getInitialStatus: () => status,
      });

      // ── Channel ─────────────────────────────────────────────────────

      context.registerChannel({
        id: 'discord',
        pluginId: PLUGIN_ID,
        description: 'Discord channel transport',
        connector: true,
        sessionPrefix: 'dc-',
        send: async (payload) => {
          if (!client || !discordConfig.primaryChannelId) {
            logger.warn('Discord: cannot send — no client or primary channel');
            return;
          }
          const channel = await client.channels.fetch(discordConfig.primaryChannelId).catch(() => null);
          if (!channel || !('send' in channel)) return;
          const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          const parts = splitMessage(text, 2000);
          for (const part of parts) {
            await (channel as import('discord.js').TextChannel).send(part);
          }
        },
      });

      // ── Tools ───────────────────────────────────────────────────────

      context.registerTool({
        id: 'discord.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get Discord connector status. Args: {}',
        execute: async () => ({
          ok: true,
          output: {
            status,
            primaryChannelId: discordConfig.primaryChannelId ?? null,
            authorizedChannels: discordConfig.authorizedChannelIds.length,
          } as unknown as JsonValue,
        }),
      });

      context.registerTool({
        id: 'discord.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send a message to a Discord channel. Args: { channelId?: string, text: string }',
        parameters: z.object({
          channelId: z.string().optional().describe('Target channel ID (defaults to primary)'),
          text: z.string().describe('Message text to send'),
        }),
        execute: async (args) => {
          try {
            if (!client) return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Discord bot not connected' } };
            const input = asObject(args);
            const channelId = typeof input.channelId === 'string' ? input.channelId : discordConfig.primaryChannelId;
            const text = asString(input.text, 'text');
            if (!channelId) return { ok: false, error: { code: 'NO_CHANNEL', message: 'No channel ID specified' } };
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel || !('send' in channel)) return { ok: false, error: { code: 'CHANNEL_ERROR', message: 'Channel not found or not text' } };
            const parts = splitMessage(text, 2000);
            for (const part of parts) {
              await (channel as import('discord.js').TextChannel).send(part);
            }
            return { ok: true, output: 'sent' };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'discord.add_channel',
        title: 'Authorize',
        pluginId: PLUGIN_ID,
        description: 'Authorize a Discord channel. Args: { channelId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const channelId = asString(input.channelId, 'channelId');
            if (!discordConfig.authorizedChannelIds.includes(channelId)) {
              discordConfig.authorizedChannelIds.push(channelId);
              if (!discordConfig.primaryChannelId) discordConfig.primaryChannelId = channelId;
              await saveConfig();
            }
            return { ok: true, output: `Channel ${channelId} authorized` };
          } catch (err) {
            return { ok: false, error: { code: 'ADD_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'discord.remove_channel',
        title: 'Revoke',
        pluginId: PLUGIN_ID,
        description: 'Remove a Discord channel authorization. Args: { channelId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const channelId = asString(input.channelId, 'channelId');
            discordConfig.authorizedChannelIds = discordConfig.authorizedChannelIds.filter((id) => id !== channelId);
            if (discordConfig.primaryChannelId === channelId) {
              discordConfig.primaryChannelId = discordConfig.authorizedChannelIds[0];
            }
            await saveConfig();
            return { ok: true, output: `Channel ${channelId} removed` };
          } catch (err) {
            return { ok: false, error: { code: 'REMOVE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'discord.set_primary',
        title: 'Primary',
        pluginId: PLUGIN_ID,
        description: 'Set the primary Discord channel. Args: { channelId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const channelId = asString(input.channelId, 'channelId');
            discordConfig.primaryChannelId = channelId;
            if (!discordConfig.authorizedChannelIds.includes(channelId)) {
              discordConfig.authorizedChannelIds.push(channelId);
            }
            await saveConfig();
            return { ok: true, output: `Primary channel set to ${channelId}` };
          } catch (err) {
            return { ok: false, error: { code: 'SET_PRIMARY_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ────────────────────────────────────────────────────

      context.registerCommand({
        id: 'discord',
        pluginId: PLUGIN_ID,
        description: 'Discord connector status and management',
        subcommands: ['status', 'setup'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(`Status: ${status}\nPrimary: ${discordConfig.primaryChannelId ?? 'none'}\nChannels: ${discordConfig.authorizedChannelIds.join(', ') || 'none'}\n`);
            return 0;
          }

          if (sub === 'setup') {
            const token = args[1] ?? process.env.DISCORD_BOT_TOKEN;
            if (!token) {
              commandContext.stderr.write('Usage: discord setup <bot-token> or set DISCORD_BOT_TOKEN env\n');
              return 1;
            }
            discordConfig.botToken = token;
            await saveConfig();
            commandContext.stdout.write('Discord bot token saved. Restart to connect.\n');
            return 0;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── Gateway method ──────────────────────────────────────────────

      context.registerGatewayMethod({
        id: 'discord.send',
        pluginId: PLUGIN_ID,
        description: 'Send payload to discord channel',
        handler: async (params) => {
          if (!client || !discordConfig.primaryChannelId) return { ok: false, error: 'not connected' } as unknown as JsonValue;
          const channel = await client.channels.fetch(discordConfig.primaryChannelId).catch(() => null);
          if (!channel || !('send' in channel)) return { ok: false, error: 'channel not found' } as unknown as JsonValue;
          const text = typeof params === 'string' ? params : JSON.stringify(params);
          const parts = splitMessage(text, 2000);
          for (const part of parts) {
            await (channel as import('discord.js').TextChannel).send(part);
          }
          return { ok: true } as unknown as JsonValue;
        },
      });

      // ── HTTP webhook route ──────────────────────────────────────────

      context.registerHttpRoute({
        method: 'POST',
        path: '/discord/webhook',
        pluginId: PLUGIN_ID,
        description: 'Discord webhook ingress',
        handler: async (req, res) => {
          let body = '';
          for await (const chunk of req) { body += String(chunk); }
          logger.info('Discord webhook received', { bodyLength: body.length });
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":true}\n');
        },
      });

      // ── Startup hook ────────────────────────────────────────────────

      context.registerHook({
        id: 'discord.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        handler: async () => {
          await loadConfig();
          const token = discordConfig.botToken ?? process.env.DISCORD_BOT_TOKEN;
          if (!token) {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:discord:status', { status: 'disconnected' });
            return;
          }
          status = 'busy';
          updateIndicatorStatus?.('busy');
          kernel?.events.publish('connector:discord:status', { status: 'busy' });

          void (async () => {
            const locked = await acquireLock();
            if (!locked) {
              status = 'busy';
              updateIndicatorStatus?.('busy');
              kernel?.events.publish('connector:discord:status', { status: 'busy' });
              logger.info('Discord locked by another instance');
              return;
            }

            try {
              const { Client, GatewayIntentBits } = await import('discord.js');
              client = new Client({
                intents: [
                  GatewayIntentBits.Guilds,
                  GatewayIntentBits.GuildMessages,
                  GatewayIntentBits.MessageContent,
                  GatewayIntentBits.DirectMessages,
                ],
              });

              const transcription = context.getService<TranscriptionService>('transcription.service');

              client.on('messageCreate', async (message) => {
                if (message.author.bot) return;
                const channelId = message.channelId;
                if (!isAuthorized(channelId)) return;
                if (!agentSession) return;

                // Typing indicator
                const typingInterval = setInterval(() => {
                  void message.channel.sendTyping().catch(() => {});
                }, 8000);
                void message.channel.sendTyping().catch(() => {});

                try {
                  // Check for image attachments
                  const images: string[] = [];
                  for (const attachment of message.attachments.values()) {
                    const ext = (attachment.name ?? '').toLowerCase().split('.').pop() ?? '';
                    if (IMAGE_EXTENSIONS.includes(`.${ext}`) || (attachment.contentType?.startsWith('image/') ?? false)) {
                      try {
                        const imgResponse = await fetch(attachment.url);
                        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
                        const base64 = imgBuffer.toString('base64');
                        const mimeType = attachment.contentType ?? 'image/png';
                        images.push(`data:${mimeType};base64,${base64}`);
                      } catch { /* skip image */ }
                    }
                  }

                  // Check for voice attachments
                  let voiceText = '';
                  if (transcription) {
                    for (const attachment of message.attachments.values()) {
                      const ext = (attachment.name ?? '').toLowerCase().split('.').pop() ?? '';
                      if (VOICE_EXTENSIONS.includes(`.${ext}`)) {
                        try {
                          const { text } = await transcription.transcribeFromUrl(attachment.url);
                          voiceText += ` ${text}`;
                        } catch { /* skip voice */ }
                      }
                    }
                  }

                  const userContent = (message.content + voiceText).trim() || (images.length > 0 ? 'What is in this image?' : '');
                  if (!userContent) return;

                  // Parse @agent_id routing prefix
                  const routing = parseAgentRouting(userContent);
                  const routedAgentId = routing.agentId;
                  const routedMessage = routing.message;

                  // Validate agent exists in registry (if specified)
                  if (routedAgentId) {
                    const agentRegistry = context.getService<AgentRegistry>('agents.registry');
                    if (agentRegistry) {
                      const agent = agentRegistry.get(routedAgentId);
                      if (!agent) {
                        await message.channel.send(`Unknown agent: @${routedAgentId}. Use agents.list to see available agents.`);
                        return;
                      }
                    }
                  }

                  const response = await agentSession.chat(channelId, routedMessage, {
                    sessionId: `dc-${channelId}`,
                    agentId: routedAgentId ?? 'default-agent',
                    images: images.length > 0 ? images : undefined,
                  });

                  const parts = splitMessage(response, 2000);
                  for (const part of parts) {
                    await message.channel.send(part);
                  }
                } catch (err) {
                  logger.error('Discord message handler error', { error: String(err) });
                  await message.channel.send('An error occurred processing your message.').catch(() => {});
                } finally {
                  clearInterval(typingInterval);
                }
              });

              await client.login(token);
              status = 'connected';
              updateIndicatorStatus?.('connected');
              kernel?.events.publish('connector:discord:status', { status: 'connected' });
              logger.info('Discord bot connected');
            } catch (err) {
              status = 'disconnected';
              updateIndicatorStatus?.('disconnected');
              kernel?.events.publish('connector:discord:status', { status: 'disconnected' });
              logger.error('Discord bot launch failed', { error: String(err) });
              await releaseLock();
            }
          })().catch((err) => {
            status = 'disconnected';
            updateIndicatorStatus?.('disconnected');
            kernel?.events.publish('connector:discord:status', { status: 'disconnected' });
            logger.error('Discord async startup connect failed', { error: String(err) });
          });
        },
      });

      // ── Shutdown hook ───────────────────────────────────────────────

      context.registerHook({
        id: 'discord.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          if (client) {
            await client.destroy();
            client = null;
          }
          status = 'disconnected';
          updateIndicatorStatus?.('disconnected');
          kernel?.events.publish('connector:discord:status', { status: 'disconnected' });
          await releaseLock();
        },
      });

      // Tool descriptions are self-explanatory; no extra prompt section needed.
    },
  };
}

export { createDiscordPlugin as createPlugin };
