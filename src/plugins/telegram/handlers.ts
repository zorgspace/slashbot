import type { Telegraf } from 'telegraf';
import type { JsonValue, StructuredLogger } from '@slashbot/plugin-sdk';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel';
import type { TranscriptionProvider } from '../services/transcription-service';
import type { AgentRegistry } from '../agents/index';
import { splitMessage } from '../utils';
import type { TelegramMessageDirection, TelegramMessageModality, TelegramState } from './types';
import { DEFAULT_AGENT_ID, PRIVATE_AGENTIC_TIMEOUT_MS } from './types.js';
import { isAuthorized, authorizeChatId } from './config.js';
import {
  extractCommandPayload,
  parseAgentRouting,
  resolveChatContext,
  sendWithRetry,
  trimForUiEvent,
  isPrivateChatId,
} from './utils.js';

// ── Message publishing helpers ──────────────────────────────────────

function publishTelegramMessage(
  kernel: SlashbotKernel,
  direction: TelegramMessageDirection,
  chatId: string,
  text: string,
  modality: TelegramMessageModality = 'text',
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  kernel.events.publish('connector:telegram:message', {
    direction,
    chatId,
    modality,
    text: trimForUiEvent(trimmed),
  });
}

// ── Chat job queue ──────────────────────────────────────────────────

export function enqueueChatJob(state: TelegramState, chatId: string, job: () => Promise<void>): number {
  const queue = state.pendingJobsByChat.get(chatId) ?? [];
  const position = (state.processingChats.has(chatId) ? 1 : 0) + queue.length + 1;
  queue.push(job);
  state.pendingJobsByChat.set(chatId, queue);
  if (!state.processingChats.has(chatId)) {
    void drainChatJobs(state, chatId);
  }
  return position;
}

async function drainChatJobs(state: TelegramState, chatId: string): Promise<void> {
  if (state.processingChats.has(chatId)) return;
  state.processingChats.add(chatId);
  try {
    while (true) {
      const queue = state.pendingJobsByChat.get(chatId);
      const next = queue?.shift();
      if (!next) {
        state.pendingJobsByChat.delete(chatId);
        break;
      }
      try {
        await next();
      } catch {
        // Keep draining queued jobs even if one task fails unexpectedly.
      }
    }
  } finally {
    state.processingChats.delete(chatId);
    if ((state.pendingJobsByChat.get(chatId)?.length ?? 0) > 0) {
      void drainChatJobs(state, chatId);
    }
  }
}

function shouldSendCommandHint(state: TelegramState, chatId: string, isGroup: boolean): boolean {
  const now = Date.now();
  const cooldownMs = isGroup ? 30_000 : 10_000;
  const last = state.lastCommandHintByChat.get(chatId) ?? 0;
  if (now - last < cooldownMs) return false;
  state.lastCommandHintByChat.set(chatId, now);
  return true;
}

// ── Send markdown to chat ───────────────────────────────────────────

export async function sendMarkdownToChat(
  telegram: import('telegraf').Telegram,
  chatId: string,
  text: string,
): Promise<void> {
  const parts = splitMessage(text, 4000);
  if (parts.length === 0) return;
  for (const part of parts) {
    await sendWithRetry(async () => {
      try {
        await telegram.sendMessage(chatId, part, { parse_mode: 'Markdown' });
      } catch {
        await telegram.sendMessage(chatId, part);
      }
    });
  }
}

// ── Message task enqueue ────────────────────────────────────────────

export function enqueueMessageTask(
  state: TelegramState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  args: {
    chatId: string;
    contextKey: string;
    sessionId: string;
    isPrivate: boolean;
    prompt: string;
    modality: TelegramMessageModality;
    images?: string[];
    agentId?: string;
    replyMarkdown: (text: string) => Promise<void>;
    failMessage: string;
  },
): void {
  enqueueChatJob(state, args.chatId, async () => {
    try {
      if (args.isPrivate) {
        state.privateChatBySessionId.set(args.sessionId, args.chatId);
      }
      const session = args.isPrivate ? state.privateAgentSession : state.agentSession;
      if (!session) throw new Error('Telegram agent session unavailable');

      const lifecycleAgentId = `telegram-agent:${args.contextKey}`;
      await kernel.sendMessageLifecycle('message_received', args.sessionId, lifecycleAgentId, args.prompt);
      await kernel.sendMessageLifecycle('message_sending', args.sessionId, lifecycleAgentId, args.prompt);

      let response: string;
      if (args.isPrivate) {
        const ac = new AbortController();
        const agenticTimeout = setTimeout(() => ac.abort(), PRIVATE_AGENTIC_TIMEOUT_MS);
        try {
          response = await session.chat(args.contextKey, args.prompt, {
            sessionId: args.sessionId,
            agentId: args.agentId ?? DEFAULT_AGENT_ID,
            images: args.images,
            abortSignal: ac.signal,
          });
        } finally {
          clearTimeout(agenticTimeout);
        }
      } else {
        response = await session.chat(args.contextKey, args.prompt, {
          sessionId: args.sessionId,
          agentId: args.agentId ?? DEFAULT_AGENT_ID,
          images: args.images,
        });
      }

      await kernel.sendMessageLifecycle('message_sent', args.sessionId, lifecycleAgentId, response);

      publishTelegramMessage(kernel, 'out', args.chatId, response, args.modality);
      const parts = splitMessage(response, 4000);
      if (parts.length === 0) {
        await sendWithRetry(() => args.replyMarkdown('(empty response)'));
        return;
      }
      for (const part of parts) {
        await sendWithRetry(() => args.replyMarkdown(part));
      }
    } catch (err) {
      logger.error('Telegram queued message task failed', {
        chatId: args.chatId,
        contextKey: args.contextKey,
        error: String(err),
      });
      await sendWithRetry(() => args.replyMarkdown(args.failMessage)).catch(() => {});
    }
  });
}

// ── Resolve default private chat for tool calls ─────────────────────

export function resolveDefaultPrivateChatId(state: TelegramState, sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  const mappedChatId = state.privateChatBySessionId.get(sessionId);
  if (!mappedChatId) return undefined;
  if (!isPrivateChatId(mappedChatId)) return undefined;
  if (!isAuthorized(state, mappedChatId)) return undefined;
  return mappedChatId;
}

// ── Setup Telegraf handlers ─────────────────────────────────────────

export function setupHandlers(
  bot: Telegraf,
  state: TelegramState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  getTranscription: () => TranscriptionProvider | undefined,
  getAgentRegistry: () => AgentRegistry | undefined,
): void {
  // Text handler
  bot.on('text', async (ctx) => {
    const { chatId, contextKey, sessionId } = resolveChatContext(ctx.chat);
    const text = ctx.message.text?.trim();
    if (!text) return;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

    if (/^\/chatid(?:@[\w_]+)?$/i.test(text)) {
      if (ctx.chat.type === 'private' && !isAuthorized(state, chatId)) {
        try {
          await authorizeChatId(state, chatId);
        } catch (err) {
          logger.error('Telegram /chatid authorization failed', { error: String(err), chatId });
        }
      }
      const lines = [
        `Chat ID: \`${chatId}\``,
        `Type: ${ctx.chat.type}`,
        `Authorized: ${isAuthorized(state, chatId) ? 'yes' : 'no'}`,
      ];
      if (isGroup) {
        lines.push('Use `/groupchatid` once in this group to authorize `/chat` and `/say`.');
      } else {
        lines.push('Use `/chat <message>` or `/say <message>` to talk to Slashbot.');
      }
      try {
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(lines.join('\n')).catch(() => {});
      }
      return;
    }

    if (/^\/groupchatid(?:@[\w_]+)?$/i.test(text)) {
      if (!isGroup) {
        await ctx.reply('This command only works in group chats.').catch(() => {});
        return;
      }
      try {
        await authorizeChatId(state, chatId);
        const info = `Group authorized.\nChat ID: \`${chatId}\`\nUse /chat or /say in this group.`;
        try {
          await ctx.reply(info, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(info).catch(() => {});
        }
      } catch (err) {
        logger.error('Telegram /groupchatid authorization failed', { error: String(err), chatId });
        await ctx.reply('Failed to authorize this group chat.').catch(() => {});
      }
      return;
    }

    if (!isAuthorized(state, chatId)) {
      if (isGroup) {
        await ctx.reply('This group is not authorized. Run /groupchatid once to enable /chat and /say.').catch(() => {});
      } else {
        await ctx.reply('This chat is not authorized yet. Send /chatid to authorize it.').catch(() => {});
      }
      return;
    }

    const commandPayload = extractCommandPayload(text, [state.config.triggerCommand, '/say']);
    const commandRequired = isGroup || state.config.responseGate === 'command';
    if (commandRequired && commandPayload === null) {
      if (shouldSendCommandHint(state, chatId, isGroup)) {
        const trigger = state.config.triggerCommand.startsWith('/') ? state.config.triggerCommand : `/${state.config.triggerCommand}`;
        const hint = isGroup
          ? `In groups, use \`${trigger} <message>\` or \`/say <message>\`.`
          : `Use \`${trigger} <message>\` or \`/say <message>\`.`;
        try {
          await ctx.reply(hint, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(hint).catch(() => {});
        }
      }
      return;
    }

    const userMessage = commandPayload === null ? text : commandPayload;
    if (!userMessage) {
      await ctx.reply('Usage: /chat <message> or /say <message>').catch(() => {});
      return;
    }

    const routing = parseAgentRouting(userMessage);
    const routedAgentId = routing.agentId;
    const routedMessage = routing.message;

    if (routedAgentId) {
      const agentRegistry = getAgentRegistry();
      if (agentRegistry) {
        const agent = agentRegistry.get(routedAgentId);
        if (!agent) {
          await ctx.reply(`Unknown agent: @${routedAgentId}. Use agents.list to see available agents.`).catch(() => {});
          return;
        }
      }
    }

    publishTelegramMessage(kernel, 'in', chatId, userMessage);
    const isPrivate = ctx.chat.type === 'private';
    enqueueMessageTask(state, kernel, logger, {
      chatId,
      contextKey,
      sessionId,
      isPrivate,
      prompt: routedMessage,
      modality: 'text',
      agentId: routedAgentId,
      replyMarkdown: async (part) => {
        try {
          await ctx.reply(part, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(part);
        }
      },
      failMessage: 'An error occurred processing your message.',
    });
  });

  // Voice handler
  bot.on('voice', async (ctx) => {
    const { chatId, contextKey, sessionId } = resolveChatContext(ctx.chat);
    const transcription = getTranscription();
    if (!isAuthorized(state, chatId) || !transcription) return;

    try {
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const { text: transcribedText } = await transcription.transcribeFromUrl(fileLink.href);

      if (!transcribedText.trim()) {
        await ctx.reply('Could not transcribe voice message.');
        return;
      }
      publishTelegramMessage(kernel, 'in', chatId, transcribedText, 'voice');
      const isPrivate = ctx.chat.type === 'private';
      enqueueMessageTask(state, kernel, logger, {
        chatId,
        contextKey,
        sessionId,
        isPrivate,
        prompt: transcribedText,
        modality: 'voice',
        replyMarkdown: async (part) => {
          try {
            await ctx.reply(part, { parse_mode: 'Markdown' });
          } catch {
            await ctx.reply(part);
          }
        },
        failMessage: 'Error processing voice message.',
      });
    } catch (err) {
      logger.error('Telegram voice handler error', { error: String(err) });
      await sendWithRetry(() => ctx.reply('Error processing voice message.')).catch(() => {});
    }
  });

  // Photo handler
  bot.on('photo', async (ctx) => {
    const { chatId, contextKey, sessionId } = resolveChatContext(ctx.chat);
    if (!isAuthorized(state, chatId)) return;

    try {
      const photos = ctx.message.photo;
      if (!Array.isArray(photos) || photos.length === 0) {
        await ctx.reply('No photo payload found in message.').catch(() => {});
        return;
      }
      const largest = photos[photos.length - 1];
      const fileLink = await ctx.telegram.getFileLink(largest.file_id);

      const imageResponse = await fetch(fileLink.href);
      if (!imageResponse.ok) {
        throw new Error(`Telegram photo download failed: HTTP ${imageResponse.status}`);
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const base64 = imageBuffer.toString('base64');
      const rawContentType = imageResponse.headers.get('content-type') ?? '';
      const normalizedContentType = rawContentType.split(';')[0]?.trim().toLowerCase();
      const mimeType = normalizedContentType.startsWith('image/') ? normalizedContentType : 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const caption = ctx.message.caption ?? 'What is in this image?';
      publishTelegramMessage(kernel, 'in', chatId, caption, 'photo');
      const isPrivate = ctx.chat.type === 'private';
      enqueueMessageTask(state, kernel, logger, {
        chatId,
        contextKey,
        sessionId,
        isPrivate,
        prompt: caption,
        modality: 'photo',
        images: [dataUrl],
        replyMarkdown: async (part) => {
          try {
            await ctx.reply(part, { parse_mode: 'Markdown' });
          } catch {
            await ctx.reply(part);
          }
        },
        failMessage: 'Error processing photo.',
      });
    } catch (err) {
      logger.error('Telegram photo handler error', { error: String(err) });
      await sendWithRetry(() => ctx.reply('Error processing photo.')).catch(() => {});
    }
  });
}
