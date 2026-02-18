/**
 * @module plugins/discord
 *
 * Discord integration plugin that connects Slashbot to Discord servers via discord.js.
 * Registers a channel connector, message handlers, agentic LLM sessions, tools,
 * commands, gateway methods, and HTTP webhook routes for Discord interaction.
 *
 * Supports text messages, image attachments, and voice file transcription
 * in authorized Discord channels and DMs, with separate agent sessions
 * for guild channels and DMs (DMs include abort-aware agentic execution).
 *
 * @see {@link createDiscordPlugin} - Plugin factory function
 * @see {@link createPlugin} - Re-exported alias for createDiscordPlugin
 */
import { z } from 'zod';
import { VoltAgentAdapter } from '@slashbot/core/voltagent/index.js';
import type { LlmAdapter, TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/index.js';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk/index.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import type { AuthProfileRouter } from '@slashbot/core/providers/auth-router.js';
import { ConnectorAgentSession, SessionChatHistoryStore } from '../services/connector-agent.js';
import { PreemptiveQueue } from '../services/preemptive-queue.js';
import type { TranscriptionService } from '../services/transcription-service.js';
import { asObject, asString, splitMessage } from '../utils.js';
import type { AgentRegistry } from '../agents/index.js';

import type { DiscordState } from './types.js';
import { PLUGIN_ID, DM_AGENTIC_MAX_RESPONSE_TOKENS, DISCORD_MESSAGE_LIMIT } from './types.js';
import { loadConfig, saveConfig, isAuthorized, authorizeChannel, unauthorizeChannel, listAuthorizedChannelIds } from './config.js';
import { flushRuntimeFiles } from './lock.js';
import { setStatus, stopClientSafely, connectClient, connectIfTokenPresent } from './connection.js';
import { setupHandlers, sendToChannel, resolveDefaultDMChannelId } from './handlers.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'connector:discord:status': { status: string };
    'connector:discord:message': Record<string, JsonValue>;
  }
}

/**
 * Discord Channel plugin — full discord.js connector with context-aware agents.
 *
 * Handles text messages, image attachments, and voice file transcription
 * in authorized Discord channels and DMs. Runs an agentic LLM session
 * per channel with separate DM sessions featuring abort timeouts.
 *
 * Dependencies: transcription, providers.auth, agentic.tools
 *
 * Tools:
 *  - `discord.status`         — Get connector status.
 *  - `discord.send`           — Send a message to a Discord channel.
 *  - `discord.add_channel`    — Authorize a channel for interaction.
 *  - `discord.remove_channel` — Remove a channel authorization.
 *  - `discord.set_primary`    — Set the primary outbound channel.
 *
 * Commands:
 *  - `/discord status`        — Show connector status and authorized channels.
 *  - `/discord setup <token>` — Save bot token and connect.
 *  - `/discord channel`       — Manage authorized channels.
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
  const state: DiscordState = {
    client: null,
    status: 'disconnected',
    config: {
      authorizedChannelIds: [],
    },
    agentSession: null,
    dmAgentSession: null,
    updateIndicatorStatus: null,
    dmChannelBySessionId: new Map(),
    paths: {
      configDir: '',
      configPath: '',
      configTmpPath: '',
      lockPath: '',
      locksDirPath: '',
    },
  };

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

      state.paths.configDir = paths.home();
      state.paths.configPath = paths.home('discord.json');
      state.paths.configTmpPath = `${state.paths.configPath}.tmp`;
      state.paths.lockPath = paths.home('discord.lock');
      state.paths.locksDirPath = paths.home('locks');

      if (!kernel || !authRouter || !providers) {
        throw new Error('discord plugin requires kernel.instance, kernel.authRouter, and kernel.providers.registry');
      }

      // ── LLM adapters & agent sessions ───────────────────────────────

      const llm = new VoltAgentAdapter(
        authRouter,
        providers,
        logger,
        kernel,
        () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
      );

      const dmAgenticAdapter: LlmAdapter = {
        complete: async (input) => {
          let lastThought = '';
          let lastSummary = '';
          const autoContextKey = `discord:${input.sessionId}`;
          const unsub = kernel.events.subscribe('connector:agentic', (event) => {
            const p = event.payload as Record<string, unknown>;
            if (p.contextKey !== autoContextKey) return;
            if (p.status === 'thought' && typeof p.text === 'string') lastThought = p.text.trim();
            if ((p.status === 'compression' || p.status === 'summary') && typeof p.text === 'string') lastSummary = p.text.trim();
          });
          try {
            const result = await llm.complete({
              ...input,
              maxTokens: input.maxTokens ?? DM_AGENTIC_MAX_RESPONSE_TOKENS,
            });
            const rawText = result.text.trim();
            if (rawText.length > 0 && rawText !== '(no response)') return result;
            return { ...result, text: lastSummary || lastThought || 'Task completed, but no final response text was generated.' };
          } finally {
            unsub();
          }
        },
      };

      const sessionsStore = new SessionChatHistoryStore(paths.home('sessions'));

      state.agentSession = new ConnectorAgentSession(
        llm,
        () => kernel.assemblePrompt(),
        sessionsStore,
        undefined,
        undefined,
        2048,
      );
      state.dmAgentSession = new ConnectorAgentSession(
        dmAgenticAdapter,
        () => kernel.assemblePrompt(),
        sessionsStore,
        undefined,
        undefined,
        DM_AGENTIC_MAX_RESPONSE_TOKENS,
      );

      // ── Handler setup helper (bound to deps) ─────────────────────────

      const queue = new PreemptiveQueue();

      const boundSetupHandlers = (client: import('discord.js').Client) => {
        setupHandlers(
          client,
          state,
          queue,
          kernel,
          logger,
          () => context.getService<TranscriptionService>('transcription.service'),
          () => context.getService<AgentRegistry>('agents.registry'),
        );
      };

      // ── Status service ────────────────────────────────────────────────

      context.registerService({
        id: 'connector.discord.status',
        pluginId: PLUGIN_ID,
        description: 'Discord connector status getter',
        implementation: { getStatus: () => state.status },
      });

      state.updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.discord',
        pluginId: PLUGIN_ID,
        label: 'Discord',
        kind: 'connector',
        priority: 20,
        statusEvent: 'connector:discord:status',
        messageEvent: 'connector:discord:message',
        showActivity: true,
        connectorName: 'discord',
        getInitialStatus: () => state.status,
      });

      // ── Channel ───────────────────────────────────────────────────────

      context.registerChannel({
        id: 'discord',
        pluginId: PLUGIN_ID,
        description: 'Discord channel transport',
        connector: true,
        sessionPrefix: 'dc-',
        send: async (payload) => {
          if (!state.client) {
            logger.warn('Discord: cannot send — no client');
            return;
          }

          // Support targeted { text, chatId } payloads
          const obj = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
          const targetChannelId = typeof obj?.chatId === 'string' ? obj.chatId : state.config.primaryChannelId;
          const text = obj && typeof obj.text === 'string'
            ? obj.text
            : (typeof payload === 'string' ? payload : JSON.stringify(payload));

          if (!targetChannelId) {
            logger.warn('Discord: cannot send — no target channel');
            return;
          }

          const channel = await state.client.channels.fetch(targetChannelId).catch(() => null);
          if (!channel || !('send' in channel)) return;
          const parts = splitMessage(text, DISCORD_MESSAGE_LIMIT);
          for (const part of parts) {
            await (channel as import('discord.js').TextChannel).send(part);
          }
          kernel.events.publish('connector:discord:message', {
            direction: 'out',
            channelId: targetChannelId,
            modality: 'text',
            text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
          });
        },
      });

      // ── Tools ─────────────────────────────────────────────────────────

      context.registerTool({
        id: 'discord.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get Discord connector status. Args: {}',
        execute: async () => {
          const token = state.config.botToken ?? process.env.DISCORD_BOT_TOKEN;
          if (token) {
            await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
          }
          return {
            ok: true,
            output: {
              status: state.status,
              primaryChannelId: state.config.primaryChannelId ?? null,
              authorizedChannels: state.config.authorizedChannelIds.length,
              ownerId: state.config.ownerId ?? null,
            } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'discord.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send a message to a Discord channel. Args: { channelId?: string, text: string }',
        parameters: z.object({
          channelId: z.string().optional().describe('Target channel ID (defaults to primary)'),
          text: z.string().min(1, 'Message text must not be empty').describe('Message text to send'),
        }),
        execute: async (rawArgs, toolContext) => {
          try {
            if (!state.client) return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Discord bot not connected' } };

            const parseResult = z.object({
              channelId: z.string().optional(),
              text: z.string().min(1, 'Message text must not be empty'),
            }).safeParse(rawArgs);

            if (!parseResult.success) {
              return {
                ok: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid discord.send arguments',
                  issues: parseResult.error.issues,
                },
              };
            }

            const { text } = parseResult.data;
            const channelId = parseResult.data.channelId
              ?? resolveDefaultDMChannelId(state, toolContext.sessionId)
              ?? state.config.primaryChannelId;
            if (!channelId) return { ok: false, error: { code: 'NO_CHANNEL', message: 'No channel ID specified and no primary channel set' } };

            const channel = await state.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !('send' in channel)) return { ok: false, error: { code: 'CHANNEL_ERROR', message: 'Channel not found or not text' } };
            const parts = splitMessage(text, DISCORD_MESSAGE_LIMIT);
            for (const part of parts) {
              await (channel as import('discord.js').TextChannel).send(part);
            }
            kernel.events.publish('connector:discord:message', {
              direction: 'out',
              channelId,
              modality: 'text',
              text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
            });
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
            await authorizeChannel(state, channelId);
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
            await unauthorizeChannel(state, channelId);
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
            state.config.primaryChannelId = channelId;
            if (!state.config.authorizedChannelIds.includes(channelId)) {
              state.config.authorizedChannelIds.push(channelId);
            }
            await saveConfig(state);
            return { ok: true, output: `Primary channel set to ${channelId}` };
          } catch (err) {
            return { ok: false, error: { code: 'SET_PRIMARY_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ──────────────────────────────────────────────────────

      context.registerCommand({
        id: 'discord',
        pluginId: PLUGIN_ID,
        description: 'Discord connector status and management',
        subcommands: ['status', 'setup', 'channel'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            const token = state.config.botToken ?? process.env.DISCORD_BOT_TOKEN;
            if (state.status !== 'connected' && token) {
              await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
            }
            commandContext.stdout.write(
              `Status: ${state.status}\nPrimary: ${state.config.primaryChannelId ?? 'none'}\nOwner: ${state.config.ownerId ?? 'none'}\nChannels: ${state.config.authorizedChannelIds.join(', ') || 'none'}\nToken: ${token ? 'configured' : 'missing'}\n`,
            );
            return 0;
          }

          if (sub === 'setup') {
            const token = args[1] ?? process.env.DISCORD_BOT_TOKEN;
            if (!token) {
              commandContext.stderr.write('Usage: discord setup <bot-token> or set DISCORD_BOT_TOKEN env\n');
              return 1;
            }
            state.config.botToken = token;
            if (args[2]) {
              state.config.ownerId = args[2];
            }
            await saveConfig(state);
            commandContext.stdout.write('Discord bot token saved. Connecting...\n');
            await connectClient(state, token, kernel, logger, boundSetupHandlers);
            if (state.status === 'connected') {
              commandContext.stdout.write('Discord bot connected.\n');
            } else {
              commandContext.stderr.write('Failed to connect. Check logs for details.\n');
            }
            return state.status === 'connected' ? 0 : 1;
          }

          if (sub === 'channel') {
            const action = args[1];
            const channelId = args[2];
            if (action === 'add') {
              if (!channelId) {
                commandContext.stderr.write('Usage: discord channel add <channel-id>\n');
                return 1;
              }
              await authorizeChannel(state, channelId);
              await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
              commandContext.stdout.write(`Channel ${channelId} authorized.\n`);
              if (state.status !== 'connected') {
                commandContext.stdout.write('Discord is authorized but not connected. Run `discord setup <bot-token>` if needed.\n');
              }
              return 0;
            }
            if (action === 'remove') {
              if (!channelId) {
                commandContext.stderr.write('Usage: discord channel remove <channel-id>\n');
                return 1;
              }
              await unauthorizeChannel(state, channelId);
              commandContext.stdout.write(`Channel ${channelId} removed.\n`);
              return 0;
            }
            commandContext.stdout.write(`Authorized channels: ${state.config.authorizedChannelIds.join(', ') || 'none'}\nPrimary: ${state.config.primaryChannelId ?? 'none'}\n`);
            return 0;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── Gateway method ────────────────────────────────────────────────

      context.registerGatewayMethod({
        id: 'discord.send',
        pluginId: PLUGIN_ID,
        description: 'Send payload to discord channel',
        handler: async (params) => {
          if (!state.client || !state.config.primaryChannelId) return { ok: false, error: 'not connected' } as unknown as JsonValue;

          const schema = z.union([
            z.string().min(1, 'Message text must not be empty'),
            z.object({
              text: z.string().min(1, 'Message text must not be empty'),
              channelId: z.string().optional(),
            }),
          ]);

          const result = schema.safeParse(params);
          if (!result.success) {
            return {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid discord.send gateway payload',
                issues: result.error.issues,
              },
            } as unknown as JsonValue;
          }

          const text = typeof result.data === 'string' ? result.data : result.data.text;
          const targetChannelId = typeof result.data === 'object' && result.data.channelId
            ? result.data.channelId
            : state.config.primaryChannelId;

          const channel = await state.client.channels.fetch(targetChannelId).catch(() => null);
          if (!channel || !('send' in channel)) return { ok: false, error: 'channel not found' } as unknown as JsonValue;
          const parts = splitMessage(text, DISCORD_MESSAGE_LIMIT);
          for (const part of parts) {
            await (channel as import('discord.js').TextChannel).send(part);
          }
          kernel.events.publish('connector:discord:message', {
            direction: 'out',
            channelId: targetChannelId,
            modality: 'text',
            text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
          });
          return { ok: true } as unknown as JsonValue;
        },
      });

      // ── HTTP webhook route ────────────────────────────────────────────

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

      // ── Startup hook ──────────────────────────────────────────────────

      context.registerHook({
        id: 'discord.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        timeoutMs: 5000,
        handler: async () => {
          await loadConfig(state);
          await flushRuntimeFiles(state);
          const token = state.config.botToken ?? process.env.DISCORD_BOT_TOKEN;
          if (!token) {
            setStatus(state, 'disconnected', kernel);
            logger.info('Discord: no token configured');
            return;
          }
          void connectClient(state, token, kernel, logger, boundSetupHandlers).catch((err) => {
            setStatus(state, 'disconnected', kernel);
            logger.error('Discord async startup connect failed', { error: String(err) });
          });
        },
      });

      // ── Shutdown hook ─────────────────────────────────────────────────

      context.registerHook({
        id: 'discord.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          await stopClientSafely(state);
          queue.shutdown();
          state.dmChannelBySessionId.clear();
          setStatus(state, 'disconnected', kernel);
          await flushRuntimeFiles(state);
        },
      });
    },
  };
}

/** Re-export of {@link createDiscordPlugin} as the standard plugin entry point. */
export { createDiscordPlugin as createPlugin };
