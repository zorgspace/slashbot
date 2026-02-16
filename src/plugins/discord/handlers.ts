import type { Client, Message } from 'discord.js';
import type { JsonValue, StructuredLogger } from '@slashbot/plugin-sdk';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { TranscriptionService } from '../services/transcription-service.js';
import type { AgentRegistry } from '../agents/index.js';
import { splitMessage } from '../utils.js';
import type { DiscordMessageDirection, DiscordMessageModality, DiscordState } from './types.js';
import { DEFAULT_AGENT_ID, DM_AGENTIC_TIMEOUT_MS, DISCORD_MESSAGE_LIMIT, TYPING_INTERVAL_MS } from './types.js';
import { isAuthorized, authorizeChannel } from './config.js';
import {
  parseAgentRouting,
  resolveChatContext,
  isDMChannel,
  sendWithRetry,
  trimForUiEvent,
} from './utils.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VOICE_EXTENSIONS = new Set(['.ogg', '.mp3', '.wav', '.m4a', '.flac']);

// ── Message publishing helpers ──────────────────────────────────────

function publishDiscordMessage(
  kernel: SlashbotKernel,
  direction: DiscordMessageDirection,
  channelId: string,
  text: string,
  modality: DiscordMessageModality = 'text',
  metadata?: Record<string, string>,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  kernel.events.publish('connector:discord:message', {
    direction,
    channelId,
    modality,
    text: trimForUiEvent(trimmed),
    ...(metadata ?? {}),
  });
}

// ── Chat job queue ──────────────────────────────────────────────────

export function enqueueChatJob(state: DiscordState, channelId: string, job: () => Promise<void>): number {
  const queue = state.pendingJobsByChannel.get(channelId) ?? [];
  const position = (state.processingChannels.has(channelId) ? 1 : 0) + queue.length + 1;
  queue.push(job);
  state.pendingJobsByChannel.set(channelId, queue);
  if (!state.processingChannels.has(channelId)) {
    void drainChatJobs(state, channelId);
  }
  return position;
}

async function drainChatJobs(state: DiscordState, channelId: string): Promise<void> {
  if (state.processingChannels.has(channelId)) return;
  state.processingChannels.add(channelId);
  try {
    while (true) {
      const queue = state.pendingJobsByChannel.get(channelId);
      const next = queue?.shift();
      if (!next) {
        state.pendingJobsByChannel.delete(channelId);
        break;
      }
      try {
        await next();
      } catch {
        // Keep draining queued jobs even if one task fails unexpectedly.
      }
    }
  } finally {
    state.processingChannels.delete(channelId);
    if ((state.pendingJobsByChannel.get(channelId)?.length ?? 0) > 0) {
      void drainChatJobs(state, channelId);
    }
  }
}

// ── Send to channel ─────────────────────────────────────────────────

export async function sendToChannel(
  message: Message,
  text: string,
): Promise<void> {
  const parts = splitMessage(text, DISCORD_MESSAGE_LIMIT);
  if (parts.length === 0) return;
  for (const part of parts) {
    await sendWithRetry(() => (message.channel as any).send(part));
  }
}

// ── Message task enqueue ────────────────────────────────────────────

export function enqueueMessageTask(
  state: DiscordState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  args: {
    channelId: string;
    contextKey: string;
    sessionId: string;
    isDM: boolean;
    prompt: string;
    modality: DiscordMessageModality;
    images?: string[];
    agentId?: string;
    message: Message;
    metadata: Record<string, string>;
  },
): void {
  enqueueChatJob(state, args.channelId, async () => {
    // Start typing indicator
    const typingInterval = setInterval(() => {
      void (args.message.channel as any).sendTyping().catch(() => {});
    }, TYPING_INTERVAL_MS);
    void (args.message.channel as any).sendTyping().catch(() => {});

    try {
      if (args.isDM) {
        state.dmChannelBySessionId.set(args.sessionId, args.channelId);
      }
      const session = args.isDM ? state.dmAgentSession : state.agentSession;
      if (!session) throw new Error('Discord agent session unavailable');

      const lifecycleAgentId = `discord-agent:${args.contextKey}`;
      await kernel.sendMessageLifecycle('message_received', args.sessionId, lifecycleAgentId, args.prompt);
      await kernel.sendMessageLifecycle('message_sending', args.sessionId, lifecycleAgentId, args.prompt);

      let response: string;
      if (args.isDM) {
        const ac = new AbortController();
        const agenticTimeout = setTimeout(() => ac.abort(), DM_AGENTIC_TIMEOUT_MS);
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

      publishDiscordMessage(kernel, 'out', args.channelId, response, args.modality, args.metadata);
      const parts = splitMessage(response, DISCORD_MESSAGE_LIMIT);
      if (parts.length === 0) {
        await sendWithRetry(() => (args.message.channel as any).send('(empty response)'));
        return;
      }
      for (const part of parts) {
        await sendWithRetry(() => (args.message.channel as any).send(part));
      }
    } catch (err) {
      logger.error('Discord queued message task failed', {
        channelId: args.channelId,
        contextKey: args.contextKey,
        error: String(err),
      });
      await sendWithRetry(() => (args.message.channel as any).send('An error occurred processing your message.')).catch(() => {});
    } finally {
      clearInterval(typingInterval);
    }
  });
}

// ── Resolve default DM channel for tool calls ───────────────────────

export function resolveDefaultDMChannelId(state: DiscordState, sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  const mappedChannelId = state.dmChannelBySessionId.get(sessionId);
  if (!mappedChannelId) return undefined;
  if (!isAuthorized(state, mappedChannelId)) return undefined;
  return mappedChannelId;
}

// ── Build metadata (picoclaw-inspired) ──────────────────────────────

function buildMessageMetadata(message: Message): Record<string, string> {
  return {
    message_id: message.id,
    user_id: message.author.id,
    username: message.author.username,
    display_name: message.author.displayName ?? message.author.username,
    guild_id: message.guildId ?? '',
    channel_id: message.channelId,
    is_dm: String(isDMChannel(message.guildId)),
  };
}

// ── Setup Discord handlers ──────────────────────────────────────────

export function setupHandlers(
  client: Client,
  state: DiscordState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  getTranscription: () => TranscriptionService | undefined,
  getAgentRegistry: () => AgentRegistry | undefined,
): void {
  client.on('messageCreate', async (message) => {
    // Ignore bots (including self)
    if (message.author.bot) return;

    const channelId = message.channelId;
    const isDM = isDMChannel(message.guildId);

    // Auto-authorize DMs from the owner
    if (isDM && state.config.ownerId && message.author.id === state.config.ownerId) {
      if (!isAuthorized(state, channelId)) {
        try {
          await authorizeChannel(state, channelId);
          logger.info('Discord: auto-authorized DM channel for owner', { channelId });
        } catch (err) {
          logger.error('Discord: failed to auto-authorize DM', { error: String(err) });
        }
      }
    }

    if (!isAuthorized(state, channelId)) return;
    if (!state.agentSession) return;

    const { contextKey, sessionId } = resolveChatContext(channelId, message.guildId);
    const metadata = buildMessageMetadata(message);
    const transcription = getTranscription();

    // Collect image attachments
    const images: string[] = [];
    for (const attachment of message.attachments.values()) {
      const ext = `.${(attachment.name ?? '').toLowerCase().split('.').pop() ?? ''}`;
      if (IMAGE_EXTENSIONS.has(ext) || (attachment.contentType?.startsWith('image/') ?? false)) {
        try {
          const imgResponse = await fetch(attachment.url);
          const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
          const base64 = imgBuffer.toString('base64');
          const mimeType = attachment.contentType ?? 'image/png';
          images.push(`data:${mimeType};base64,${base64}`);
        } catch { /* skip image */ }
      }
    }

    // Collect voice/audio attachments and transcribe
    let voiceText = '';
    if (transcription) {
      for (const attachment of message.attachments.values()) {
        const ext = `.${(attachment.name ?? '').toLowerCase().split('.').pop() ?? ''}`;
        if (VOICE_EXTENSIONS.has(ext) || (attachment.contentType?.startsWith('audio/') ?? false)) {
          try {
            const { text } = await transcription.transcribeFromUrl(attachment.url);
            if (text.trim()) {
              voiceText += ` [audio transcription: ${text.trim()}]`;
            }
          } catch (err) {
            logger.error('Discord voice transcription failed', { error: String(err) });
            voiceText += ` [audio: ${attachment.name ?? 'unknown'} (transcription failed)]`;
          }
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
      const agentRegistry = getAgentRegistry();
      if (agentRegistry) {
        const agent = agentRegistry.get(routedAgentId);
        if (!agent) {
          await (message.channel as any).send(`Unknown agent: @${routedAgentId}. Use agents.list to see available agents.`).catch(() => {});
          return;
        }
      }
    }

    publishDiscordMessage(kernel, 'in', channelId, userContent, images.length > 0 ? 'photo' : voiceText ? 'voice' : 'text', metadata);
    enqueueMessageTask(state, kernel, logger, {
      channelId,
      contextKey,
      sessionId,
      isDM,
      prompt: routedMessage,
      modality: images.length > 0 ? 'photo' : voiceText ? 'voice' : 'text',
      images: images.length > 0 ? images : undefined,
      agentId: routedAgentId,
      message,
      metadata,
    });
  });
}