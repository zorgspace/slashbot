import { z } from 'zod';
import { KernelLlmAdapter } from '../../core/agentic/llm/index';
import type { LlmAdapter, TokenModeProxyAuthService } from '../../core/agentic/llm/index';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '@slashbot/plugin-sdk';
import type { SlashbotKernel } from '../../core/kernel/kernel';
import type { ProviderRegistry } from '../../core/kernel/registries';
import type { AuthProfileRouter } from '../../core/providers/auth-router';
import { ConnectorAgentSession } from '../services/connector-agent';
import type { TranscriptionProvider } from '../services/transcription-service.js';
import { asObject, asString, splitMessage } from '../utils.js';
import type { AgentRegistry } from '../agents/index';

import type { TelegramState } from './types';
import { PLUGIN_ID, PRIVATE_AGENTIC_MAX_RESPONSE_TOKENS } from './types';
import { loadConfig, saveConfig, isAuthorized, authorizeChatId, unauthorizeChatId, listAuthorizedPrivateChatIds } from './config';
import { flushRuntimeFiles } from './lock';
import { setStatus, stopBotSafely, connectBot, connectIfTokenPresent } from './connection';
import { setupHandlers, sendMarkdownToChat, resolveDefaultPrivateChatId } from './handlers';
import { isPrivateChatId } from './utils';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'connector:telegram:status': { status: string };
    'connector:telegram:message': Record<string, JsonValue>;
  }
}

/**
 * Telegram Channel plugin — full Telegraf-based Telegram connector with agent execution.
 */
export function createTelegramPlugin(): SlashbotPlugin {
  const state: TelegramState = {
    bot: null,
    status: 'disconnected',
    config: {
      authorizedChatIds: [],
      responseGate: 'open',
      triggerCommand: '/chat',
    },
    agentSession: null,
    privateAgentSession: null,
    updateIndicatorStatus: null,
    lastCommandHintByChat: new Map(),
    privateChatBySessionId: new Map(),
    pendingJobsByChat: new Map(),
    processingChats: new Set(),
    paths: {
      configDir: '',
      configPath: '',
      configTmpPath: '',
      lockPath: '',
      locksDirPath: '',
      legacyChatStatePath: '',
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Telegram Channel',
      version: '0.1.0',
      main: 'bundled',
      description: 'Full Telegraf-based Telegram connector with agent execution',
      dependencies: ['slashbot.transcription', 'slashbot.providers.auth', 'slashbot.agentic.tools'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const paths = context.getService<PathResolver>('kernel.paths')!;

      state.paths.configDir = paths.home();
      state.paths.configPath = paths.home('telegram.json');
      state.paths.configTmpPath = `${state.paths.configPath}.tmp`;
      state.paths.lockPath = paths.home('telegram.lock');
      state.paths.locksDirPath = paths.home('locks');
      state.paths.legacyChatStatePath = paths.home('telegram-chat-state.json');

      if (!kernel || !authRouter || !providers) {
        throw new Error('telegram plugin requires kernel.instance, kernel.authRouter, and kernel.providers.registry');
      }

      // ── LLM adapters & agent sessions ───────────────────────────────

      const llm = new KernelLlmAdapter(
        authRouter,
        providers,
        logger,
        kernel,
        () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
      );

      const privateAgenticAdapter: LlmAdapter = {
        complete: async (input) => {
          let lastThought = '';
          let lastSummary = '';
          const autoContextKey = `telegram:${input.sessionId}`;
          const unsub = kernel.events.subscribe('connector:agentic', (event) => {
            const p = event.payload as Record<string, unknown>;
            if (p.contextKey !== autoContextKey) return;
            if (p.status === 'thought' && typeof p.text === 'string') lastThought = p.text.trim();
            if ((p.status === 'compression' || p.status === 'summary') && typeof p.text === 'string') lastSummary = p.text.trim();
          });
          try {
            const result = await llm.complete({
              ...input,
              maxTokens: input.maxTokens ?? PRIVATE_AGENTIC_MAX_RESPONSE_TOKENS,
            });
            const rawText = result.text.trim();
            if (rawText.length > 0 && rawText !== '(no response)') return result;
            return { ...result, text: lastSummary || lastThought || 'Task completed, but no final response text was generated.' };
          } finally {
            unsub();
          }
        },
      };

      state.agentSession = new ConnectorAgentSession(
        llm,
        () => kernel.assemblePrompt(),
        state.paths.configDir,
        undefined,
        undefined,
        2048,
      );
      state.privateAgentSession = new ConnectorAgentSession(
        privateAgenticAdapter,
        () => kernel.assemblePrompt(),
        state.paths.configDir,
        undefined,
        undefined,
        PRIVATE_AGENTIC_MAX_RESPONSE_TOKENS,
      );

      // ── Handler setup helper (bound to deps) ─────────────────────────

      const boundSetupHandlers = (bot: import('telegraf').Telegraf) => {
        setupHandlers(
          bot,
          state,
          kernel,
          logger,
          () => context.getService<TranscriptionProvider>('transcription.service'),
          () => context.getService<AgentRegistry>('agents.registry'),
        );
      };

      // ── Status service ────────────────────────────────────────────────

      context.registerService({
        id: 'connector.telegram.status',
        pluginId: PLUGIN_ID,
        description: 'Telegram connector status getter',
        implementation: { getStatus: () => state.status },
      });

      state.updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.telegram',
        pluginId: PLUGIN_ID,
        label: 'Telegram',
        kind: 'connector',
        priority: 10,
        statusEvent: 'connector:telegram:status',
        messageEvent: 'connector:telegram:message',
        showActivity: true,
        connectorName: 'telegram',
        getInitialStatus: () => state.status,
      });

      // ── Channel ───────────────────────────────────────────────────────

      context.registerChannel({
        id: 'telegram',
        pluginId: PLUGIN_ID,
        description: 'Telegram channel transport',
        connector: true,
        sessionPrefix: 'tg-',
        send: async (payload) => {
          if (!state.bot) {
            logger.warn('Telegram: cannot send — no bot');
            return;
          }
          const chatIds = listAuthorizedPrivateChatIds(state);
          if (chatIds.length === 0) {
            logger.warn('Telegram: cannot send — no authorized private chat IDs');
            return;
          }
          const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          for (const chatId of chatIds) {
            await sendMarkdownToChat(state.bot.telegram, chatId, text);
            kernel.events.publish('connector:telegram:message', {
              direction: 'out',
              chatId,
              modality: 'text',
              text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
            });
          }
        },
      });

      // ── Tools ─────────────────────────────────────────────────────────

      context.registerTool({
        id: 'telegram.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get Telegram connector status. Args: {}',
        execute: async () => {
          const token = state.config.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
          if (token) {
            await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
          }
          return {
            ok: true,
            output: {
              status: state.status,
              authorizedChatIds: [...state.config.authorizedChatIds],
              authorizedChats: state.config.authorizedChatIds.length,
              responseGate: state.config.responseGate,
            } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'telegram.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send a message to a Telegram chat. Args: { chatId?: string, text: string }',
        parameters: z.object({
          chatId: z.string().optional().describe('Target chat ID (defaults to originating private chat, otherwise all authorized private chats)'),
          text: z.string().min(1, 'Message text must not be empty').describe('Message text to send'),
        }),
        execute: async (rawArgs, toolContext) => {
          try {
            if (!state.bot) return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Telegram bot not connected' } };

            const parseResult = z.object({
              chatId: z.string().optional(),
              text: z.string().min(1, 'Message text must not be empty'),
            }).safeParse(rawArgs);

            if (!parseResult.success) {
              return {
                ok: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid telegram.send arguments',
                  issues: parseResult.error.issues,
                },
              };
            }

            const { chatId, text } = parseResult.data;
            const defaultChatId = resolveDefaultPrivateChatId(state, toolContext.sessionId);

            if (typeof chatId === 'string') {
              const numId = Number(chatId);
              if (!Number.isNaN(numId) && numId < 0) {
                return { ok: false, error: { code: 'GROUP_DENIED', message: 'Sending to group chats is not allowed. Only private (default) chats are permitted.' } };
              }
            }

            const chatIds = typeof chatId === 'string'
              ? [chatId]
              : defaultChatId
                ? [defaultChatId]
                : listAuthorizedPrivateChatIds(state);
            const privateChatIds = chatIds.filter((id) => {
              const n = Number(id);
              return Number.isNaN(n) || n >= 0;
            });
            if (privateChatIds.length === 0) {
              return { ok: false, error: { code: 'NO_CHAT', message: 'No private chat IDs configured (group chats are not allowed)' } };
            }

            for (const id of privateChatIds) {
              await sendMarkdownToChat(state.bot.telegram, id, text);
              kernel.events.publish('connector:telegram:message', {
                direction: 'out',
                chatId: id,
                modality: 'text',
                text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
              });
            }

            return { ok: true, output: privateChatIds.length === 1 ? 'sent' : `sent to ${privateChatIds.length} chats` };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'telegram.add_chat',
        title: 'Authorize',
        pluginId: PLUGIN_ID,
        description: 'Authorize a Telegram chat. Args: { chatId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const chatId = asString(input.chatId, 'chatId');
            await authorizeChatId(state, chatId);
            return { ok: true, output: `Chat ${chatId} authorized` };
          } catch (err) {
            return { ok: false, error: { code: 'ADD_CHAT_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'telegram.remove_chat',
        title: 'Revoke',
        pluginId: PLUGIN_ID,
        description: 'Remove a Telegram chat authorization. Args: { chatId: string }',
        execute: async (args) => {
          try {
            const input = asObject(args);
            const chatId = asString(input.chatId, 'chatId');
            await unauthorizeChatId(state, chatId);
            return { ok: true, output: `Chat ${chatId} removed` };
          } catch (err) {
            return { ok: false, error: { code: 'REMOVE_CHAT_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ──────────────────────────────────────────────────────

      context.registerCommand({
        id: 'telegram',
        pluginId: PLUGIN_ID,
        description: 'Telegram connector status and management',
        subcommands: ['status', 'setup', 'chatid', 'groupchatid'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            const token = state.config.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
            if (state.status !== 'connected' && token) {
              await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
            }
            commandContext.stdout.write(`Status: ${state.status}\nChats: ${state.config.authorizedChatIds.join(', ') || 'none'}\nGate: ${state.config.responseGate}\nToken: ${token ? 'configured' : 'missing'}\n`);
            return 0;
          }

          if (sub === 'setup') {
            const token = args[1] ?? process.env.TELEGRAM_BOT_TOKEN;
            if (!token) {
              commandContext.stderr.write('Usage: telegram setup <bot-token> or set TELEGRAM_BOT_TOKEN env\n');
              return 1;
            }
            state.config.botToken = token;
            await saveConfig(state);
            commandContext.stdout.write('Telegram bot token saved. Connecting...\n');
            await connectBot(state, token, kernel, logger, boundSetupHandlers);
            if (state.status === 'connected') {
              commandContext.stdout.write('Telegram bot connected.\n');
            } else {
              commandContext.stderr.write('Failed to connect. Check logs for details.\n');
            }
            return state.status === 'connected' ? 0 : 1;
          }

          if (sub === 'chatid') {
            const action = args[1];
            const chatId = args[2];
            if (action === 'add') {
              if (!chatId) {
                commandContext.stderr.write('Usage: telegram chatid add <chat-id>\n');
                return 1;
              }
              await authorizeChatId(state, chatId);
              await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
              commandContext.stdout.write(`Chat ${chatId} authorized.\n`);
              if (state.status !== 'connected') {
                commandContext.stdout.write('Telegram is authorized but not connected. Run `telegram setup <bot-token>` if needed.\n');
              }
              return 0;
            }
            if (action === 'remove') {
              if (!chatId) {
                commandContext.stderr.write('Usage: telegram chatid remove <chat-id>\n');
                return 1;
              }
              await unauthorizeChatId(state, chatId);
              commandContext.stdout.write(`Chat ${chatId} removed.\n`);
              return 0;
            }
            commandContext.stdout.write(`Authorized chats: ${state.config.authorizedChatIds.join(', ') || 'none'}\nTip: send /chatid to your bot in Telegram to reveal and authorize your private chat.\n`);
            return 0;
          }

          if (sub === 'groupchatid') {
            const action = args[1];
            const chatId = args[2];
            if (action === 'add') {
              if (!chatId) {
                commandContext.stderr.write('Usage: telegram groupchatid add <chat-id>\n');
                return 1;
              }
              await authorizeChatId(state, chatId);
              await connectIfTokenPresent(state, kernel, logger, boundSetupHandlers);
              commandContext.stdout.write(`Group chat ${chatId} authorized.\nUsers in this group can now interact with /chat or /say.\n`);
              if (state.status !== 'connected') {
                commandContext.stdout.write('Telegram is authorized but not connected. Run `telegram setup <bot-token>` if needed.\n');
              }
              return 0;
            }
            if (action === 'remove') {
              if (!chatId) {
                commandContext.stderr.write('Usage: telegram groupchatid remove <chat-id>\n');
                return 1;
              }
              await unauthorizeChatId(state, chatId);
              commandContext.stdout.write(`Group chat ${chatId} removed.\n`);
              return 0;
            }
            commandContext.stderr.write('Usage: telegram groupchatid add <chat-id> | telegram groupchatid remove <chat-id>\n');
            return 1;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── Gateway method ────────────────────────────────────────────────

      context.registerGatewayMethod({
        id: 'telegram.send',
        pluginId: PLUGIN_ID,
        description: 'Send payload to telegram channel',
        handler: async (params) => {
          if (!state.bot) return { ok: false, error: 'not connected' } as unknown as JsonValue;
          const chatIds = listAuthorizedPrivateChatIds(state);
          if (chatIds.length === 0) return { ok: false, error: 'no chat ids configured' } as unknown as JsonValue;

          const schema = z.union([
            z.string().min(1, 'Message text must not be empty'),
            z.object({
              text: z.string().min(1, 'Message text must not be empty'),
            }),
          ]);

          const result = schema.safeParse(params);
          if (!result.success) {
            return {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid telegram.send gateway payload',
                issues: result.error.issues,
              },
            } as unknown as JsonValue;
          }

          const text = typeof result.data === 'string' ? result.data : result.data.text;

          for (const chatId of chatIds) {
            await sendMarkdownToChat(state.bot.telegram, chatId, text);
            kernel.events.publish('connector:telegram:message', {
              direction: 'out',
              chatId,
              modality: 'text',
              text: text.length <= 2000 ? text : `${text.slice(0, 2000)}...[truncated]`,
            });
          }
          return { ok: true } as unknown as JsonValue;
        },
      });

      // ── HTTP webhook route ────────────────────────────────────────────

      context.registerHttpRoute({
        method: 'POST',
        path: '/telegram/webhook',
        pluginId: PLUGIN_ID,
        description: 'Telegram webhook ingress',
        handler: async (req, res) => {
          if (!state.bot) {
            res.statusCode = 503;
            res.end('{"ok":false}\n');
            return;
          }
          let body = '';
          for await (const chunk of req) { body += String(chunk); }
          try {
            const update = JSON.parse(body);
            state.bot.handleUpdate(update).catch(err => {
              logger.warn('Telegram webhook handleUpdate error', { error: String(err) });
            });
          } catch (err) {
            logger.warn('Telegram webhook parse error', { error: String(err) });
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":true}\n');
        },
      });

      // ── Startup hook ──────────────────────────────────────────────────

      context.registerHook({
        id: 'telegram.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        timeoutMs: 5000,
        handler: async () => {
          await loadConfig(state);
          await flushRuntimeFiles(state);
          const token = state.config.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
          if (!token) {
            setStatus(state, 'disconnected', kernel);
            logger.info('Telegram: no token configured');
            return;
          }
          void connectBot(state, token, kernel, logger, boundSetupHandlers).catch((err) => {
            setStatus(state, 'disconnected', kernel);
            logger.error('Telegram async startup connect failed', { error: String(err) });
          });
        },
      });

      // ── Shutdown hook ─────────────────────────────────────────────────

      context.registerHook({
        id: 'telegram.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          await stopBotSafely(state, 'shutdown');
          state.lastCommandHintByChat.clear();
          state.privateChatBySessionId.clear();
          state.pendingJobsByChat.clear();
          state.processingChats.clear();
          setStatus(state, 'disconnected', kernel);
          await flushRuntimeFiles(state);
        },
      });
    },
  };
}

export { createTelegramPlugin as createPlugin };
