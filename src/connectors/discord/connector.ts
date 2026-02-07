/**
 * Discord Connector for Slashbot
 *
 * RULES:
 * - Messages are accepted from any authorized channel in channelIds
 * - Responses are ALWAYS sent back to the same channel that sent the message
 * - Voice attachments (ogg/mp3/wav) are transcribed and processed as text
 * - Max message length: 2000 chars (auto-split if longer)
 * - Only one instance can run Discord at a time (uses lock file)
 * - Bot can create private threads with authorized users
 */

import {
  Client,
  GatewayIntentBits,
  Message as DiscordMessage,
  ChannelType,
  ThreadAutoArchiveDuration,
  TextChannel,
  PermissionFlagsBits,
} from 'discord.js';
import { display } from '../../core/ui';
import { Connector, MessageHandler, PLATFORM_CONFIGS, splitMessage } from '../base';
import { getTranscriptionService } from '../../core/services/transcription';
import { imageBuffer } from '../../core/code/imageBuffer';
import { acquireLock, releaseLock } from '../locks';
import type { EventBus } from '../../core/events/EventBus';

export interface DiscordConfig {
  botToken: string;
  channelId: string; // Primary channel ID (for backwards compatibility)
  channelIds?: string[]; // Multiple authorized channel IDs
  ownerId?: string; // Owner user ID for creating private threads
}

export class DiscordConnector implements Connector {
  readonly source = 'discord' as const;
  readonly config = PLATFORM_CONFIGS.discord;

  private client: Client;
  private channelIds: Set<string>; // All authorized channel IDs
  private primaryChannelId: string; // Primary channel for backwards compatibility
  private replyTargetChannelId: string; // Track where to send replies
  private ownerId: string | null = null; // Owner user ID
  private messageHandler: MessageHandler | null = null;
  private eventBus: EventBus | null = null;
  private running = false;

  constructor(config: DiscordConfig) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // Build set of authorized channels
    this.channelIds = new Set<string>();
    this.primaryChannelId = config.channelId;
    this.channelIds.add(config.channelId);
    if (config.channelIds) {
      for (const id of config.channelIds) {
        this.channelIds.add(id);
      }
    }

    this.replyTargetChannelId = config.channelId; // Default to primary channel
    this.ownerId = config.ownerId || null;
    this.setupHandlers(config.botToken);
  }

  private setupHandlers(token: string): void {
    this.client.once('ready', () => {
      display.connector('discord', 'connected');
      display.connectorResult(this.client.user?.tag || 'unknown');
    });

    this.client.on('messageCreate', async (message: DiscordMessage) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only respond in authorized channels
      if (!this.channelIds.has(message.channelId)) return;

      if (!this.messageHandler) {
        await message.reply('Bot not fully initialized');
        return;
      }

      // Track the channel to reply to (same channel that sent the message)
      this.replyTargetChannelId = message.channelId;

      try {
        // Start continuous typing indicator (Discord typing expires after ~10s)
        let typingInterval: ReturnType<typeof setInterval> | null = null;
        if ('sendTyping' in message.channel) {
          await message.channel.sendTyping();
          typingInterval = setInterval(() => {
            if ('sendTyping' in message.channel) {
              message.channel.sendTyping().catch(() => {});
            }
          }, 8000);
        }

        try {
          let textContent = message.content;

          // Check for image attachments
          const imageAttachments = message.attachments.filter(
            att =>
              att.contentType?.startsWith('image/') ||
              att.name?.match(/\.(png|jpg|jpeg|gif|webp)$/i),
          );

          // Process images and add to context
          for (const imgAtt of imageAttachments.values()) {
            try {
              display.connector('discord', 'image');
              const imageResponse = await fetch(imgAtt.url);
              const imageBuffer64 = Buffer.from(await imageResponse.arrayBuffer()).toString(
                'base64',
              );
              const mimeType = imgAtt.contentType || 'image/jpeg';
              const dataUrl = `data:${mimeType};base64,${imageBuffer64}`;
              imageBuffer.push(dataUrl);
              display.connectorResult(`${Math.round(imageBuffer64.length / 1024)}KB`);
            } catch (imgErr) {
              display.error(`Failed to download: ${imgErr}`);
            }
          }

          // Check for voice message attachments (Discord voice messages are ogg files)
          const voiceAttachment = message.attachments.find(
            att =>
              att.contentType?.startsWith('audio/') ||
              att.name?.endsWith('.ogg') ||
              att.name?.endsWith('.mp3') ||
              att.name?.endsWith('.wav'),
          );

          if (voiceAttachment) {
            const transcriptionService = getTranscriptionService();
            if (!transcriptionService) {
              await message.reply('Voice transcription not configured. Set OPENAI_API_KEY.');
              return;
            }

            display.connector('discord', 'transcribe');
            const result = await transcriptionService.transcribeFromUrl(voiceAttachment.url);

            if (!result || !result.text) {
              await message.reply('Could not transcribe voice message');
              return;
            }

            display.connectorResult(`"${result.text}"`);
            textContent = result.text;
          }

          // If only images and no text, use default prompt
          if (!textContent && imageAttachments.size > 0) {
            textContent = 'What is in this image?';
          }

          if (!textContent) return;

          // Process message with channel-specific session
          const response = await this.messageHandler(textContent, 'discord', {
            sessionId: `discord:${message.channelId}`,
          });

          if (response) {
            await this.sendMessageToChannel(message.channelId, response);
          }
        } finally {
          if (typingInterval) clearInterval(typingInterval);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await message.reply(`Error: ${errorMsg}`).catch(() => {});
      }
    });

    this.client.on('error', err => {
      display.connector('discord', 'error');
      display.error(err.message);
    });

    // Store token for start()
    (this.client as any)._token = token;
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Try to acquire lock - only one instance can run Discord
    const lock = await acquireLock('discord');
    if (!lock.acquired) {
      display.connector('discord', 'locked');
      display.connectorResult(
        `PID ${lock.existingPid}${lock.existingWorkDir ? ` in ${lock.existingWorkDir}` : ''}`,
      );
      return;
    }

    try {
      await this.client.login((this.client as any)._token);
      this.running = true;
      if (this.eventBus) {
        this.eventBus.emit({ type: 'connector:connected', source: 'discord' });
      }
    } catch (error) {
      await releaseLock('discord');
      display.connector('discord', 'error');
      display.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.client.destroy();
    this.running = false;
    // Release lock asynchronously
    releaseLock('discord').catch(() => {});
    if (this.eventBus) {
      this.eventBus.emit({ type: 'connector:disconnected', source: 'discord' });
    }
  }

  /**
   * Send a message to the current reply target (same channel that sent the last message)
   */
  async sendMessage(text: string): Promise<void> {
    await this.sendMessageToChannel(this.replyTargetChannelId, text);
  }

  private async sendMessageToChannel(channelId: string, text: string): Promise<void> {
    if (!this.running) {
      throw new Error('Discord bot not running');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error('Invalid channel');
    }

    const chunks = splitMessage(text, this.config.maxMessageLength);
    for (const chunk of chunks) {
      await (channel as any).send(chunk);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create a private thread in a channel and optionally add the owner
   * @param channelId - The text channel to create the thread in
   * @param name - Name of the thread
   * @param message - Optional initial message to send
   * @returns The thread channel ID
   */
  async createPrivateThread(channelId: string, name: string, message?: string): Promise<string> {
    if (!this.running) {
      throw new Error('Discord bot not running');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error('Invalid text channel');
    }

    // Create a private thread
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      type: ChannelType.PrivateThread,
      reason: 'Slashbot private conversation',
    });

    // Add the owner to the thread if configured
    if (this.ownerId) {
      try {
        await thread.members.add(this.ownerId);
      } catch {
        // Owner might not be in the guild or other permission issue
      }
    }

    // Automatically authorize this thread
    this.channelIds.add(thread.id);

    // Send initial message if provided
    if (message) {
      const chunks = splitMessage(message, this.config.maxMessageLength);
      for (const chunk of chunks) {
        await thread.send(chunk);
      }
    }

    return thread.id;
  }

  /**
   * Create a thread from a message (public or private based on permissions)
   * @param messageId - The message to create thread from
   * @param channelId - The channel containing the message
   * @param name - Name of the thread
   */
  async createThreadFromMessage(
    messageId: string,
    channelId: string,
    name: string,
  ): Promise<string> {
    if (!this.running) {
      throw new Error('Discord bot not running');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error('Invalid text channel');
    }

    const message = await channel.messages.fetch(messageId);
    const thread = await message.startThread({
      name,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    // Authorize this thread
    this.channelIds.add(thread.id);

    return thread.id;
  }

  /**
   * Add a channel to the authorized channels list
   */
  addChannel(channelId: string): void {
    this.channelIds.add(channelId);
  }

  /**
   * Remove a channel from the authorized channels list
   */
  removeChannel(channelId: string): boolean {
    // Don't remove the primary channel
    if (channelId === this.primaryChannelId) {
      return false;
    }
    return this.channelIds.delete(channelId);
  }

  /**
   * Get all authorized channel IDs
   */
  getChannelIds(): string[] {
    return Array.from(this.channelIds);
  }

  /**
   * Get the primary channel ID
   */
  getPrimaryChannelId(): string {
    return this.primaryChannelId;
  }

  /**
   * Send a message to a specific channel (must be authorized)
   */
  async sendToChannel(channelId: string, text: string): Promise<void> {
    if (!this.channelIds.has(channelId)) {
      throw new Error('Channel not authorized');
    }
    await this.sendMessageToChannel(channelId, text);
  }

  /**
   * Set the owner user ID for private threads
   */
  setOwnerId(ownerId: string): void {
    this.ownerId = ownerId;
  }

  /**
   * Get the Discord client (for advanced operations)
   */
  getClient(): Client {
    return this.client;
  }
}

export function createDiscordConnector(config: DiscordConfig): DiscordConnector {
  return new DiscordConnector(config);
}
