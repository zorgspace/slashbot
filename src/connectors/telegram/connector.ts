/**
 * Telegram Connector for Slashbot
 *
 * RULES:
 * - Messages are only accepted from authorized chatIds
 * - Responses are ALWAYS sent back to the same chatId that sent the message
 * - Voice messages are transcribed and processed as text
 * - Max message length: 4000 chars (auto-split if longer)
 * - Only one instance can run Telegram at a time (uses lock file)
 */

import { Telegraf } from 'telegraf';
import { display, formatToolAction } from '../../core/ui';
import {
  Connector,
  MessageHandler,
  PLATFORM_CONFIGS,
  splitMessage,
  type ConnectorActionSpec,
  type ConnectorCapabilities,
  type ConnectorStatus,
} from '../base';
import { getTranscriptionService } from '../../plugins/transcription/services/TranscriptionService';
import { imageBuffer } from '../../plugins/filesystem/services/ImageBuffer';
import { acquireLock, releaseLock } from '../locks';
import type { EventBus } from '../../core/events/EventBus';
import { getConnectorActionSpecs, getConnectorCapabilities } from '../catalog';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  chatIds?: string[];
}

export class TelegramConnector implements Connector {
  readonly source = 'telegram' as const;
  readonly config = PLATFORM_CONFIGS.telegram;

  private bot: Telegraf;
  private primaryChatId: string;
  private authorizedChatIds: Set<string>;
  private replyTargetChatId: string; // Track where to send replies
  private messageHandler: MessageHandler | null = null;
  private eventBus: EventBus | null = null;
  private running = false;

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.primaryChatId = config.chatId;
    this.authorizedChatIds = new Set<string>();
    this.authorizedChatIds.add(config.chatId);
    if (config.chatIds) {
      for (const id of config.chatIds) {
        this.authorizedChatIds.add(id);
      }
    }
    this.replyTargetChatId = config.chatId; // Default to primary chatId
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Only accept messages from authorized chats
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id?.toString();
      if (!chatId || !this.authorizedChatIds.has(chatId)) {
        // Silently ignore messages from unauthorized chats
        return;
      }
      await next();
    });

    // Handle text messages
    this.bot.on('text', async ctx => {
      const message = ctx.message.text;

      if (!this.messageHandler) {
        await ctx.reply('Bot not fully initialized');
        return;
      }

      const chatId = ctx.chat.id.toString();
      // Track the chat to reply to (same chat that sent the message)
      this.replyTargetChatId = chatId;

      try {
        // Start continuous typing indicator (Telegram typing expires after ~5s)
        await this.bot.telegram.sendChatAction(ctx.chat.id, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
        }, 4000);

        // Process message through slashbot with chat-specific session
        let response: string | void;
        try {
          response = await this.messageHandler(message, 'telegram', {
            sessionId: `telegram:${chatId}`,
            chatId,
          });
        } finally {
          clearInterval(typingInterval);
        }

        // Send response if any (using sendMessageTo which handles splitting)
        if (response) {
          await this.sendMessageTo(chatId, response);
        } else {
          await ctx.reply('No response generated');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Telegram] Handler error:', errorMsg);
        // Truncate error message to avoid "message too long" error
        const truncatedError = errorMsg.length > 500 ? errorMsg.slice(0, 500) + '...' : errorMsg;
        await ctx.reply(`Error: ${truncatedError}`);
      }
    });

    // Handle voice messages
    this.bot.on('voice', async ctx => {
      if (!this.messageHandler) {
        await ctx.reply('Bot not fully initialized');
        return;
      }

      const chatId = ctx.chat.id.toString();
      // Track the chat to reply to (same chat that sent the message)
      this.replyTargetChatId = chatId;

      const transcriptionService = getTranscriptionService();
      if (!transcriptionService) {
        await ctx.reply('Voice transcription not configured. Set OPENAI_API_KEY.');
        return;
      }

      try {
        // Start continuous typing indicator
        await this.bot.telegram.sendChatAction(ctx.chat.id, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
        }, 4000);

        try {
          // Get file URL from Telegram
          const fileId = ctx.message.voice.file_id;
          const file = await ctx.telegram.getFile(fileId);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.telegram.token}/${file.file_path}`;

          // Hide cursor and transcribe
          process.stdout.write('\x1b[?25l\r\x1b[K');
          display.appendAssistantMessage(formatToolAction('Telegram', 'transcribe'));
          const result = await transcriptionService.transcribeFromUrl(fileUrl);

          if (!result || !result.text) {
            process.stdout.write('\x1b[?25h');
            await ctx.reply('Could not transcribe voice message');
            return;
          }

          display.appendAssistantMessage(formatToolAction('Telegram', 'transcribe', { success: true, summary: `"${result.text}"` }));
          process.stdout.write('\n'); // Add spacing before actions

          // Process transcribed text (already displayed above)
          const response = await this.messageHandler(result.text, 'telegram', {
            alreadyDisplayed: true,
            sessionId: `telegram:${chatId}`,
            chatId,
          });
          process.stdout.write('\x1b[?25h'); // Show cursor again
          if (response) {
            await this.sendMessageTo(chatId, response);
          }
        } finally {
          clearInterval(typingInterval);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`Voice error: ${errorMsg}`);
      }
    });

    // Handle photo messages
    this.bot.on('photo', async ctx => {
      if (!this.messageHandler) {
        await ctx.reply('Bot not fully initialized');
        return;
      }

      const chatId = ctx.chat.id.toString();
      // Track the chat to reply to
      this.replyTargetChatId = chatId;

      try {
        // Start continuous typing indicator
        await this.bot.telegram.sendChatAction(ctx.chat.id, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
        }, 4000);

        try {
          // Get the largest photo (last in array)
          const photos = ctx.message.photo;
          const largestPhoto = photos[photos.length - 1];
          const file = await ctx.telegram.getFile(largestPhoto.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.telegram.token}/${file.file_path}`;

          // Download and convert to base64 data URL
          const imageResponse = await fetch(fileUrl);
          const imageBuffer64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
          const mimeType = file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${imageBuffer64}`;

          // Add to image buffer for vision context
          imageBuffer.push(dataUrl);
          display.appendAssistantMessage(formatToolAction('Telegram', 'image', { success: true, summary: `${Math.round(imageBuffer64.length / 1024)}KB` }));

          // Use caption or default prompt
          const message = ctx.message.caption || 'What is in this image?';

          // Process with the image in context
          const response = await this.messageHandler(message, 'telegram', {
            sessionId: `telegram:${chatId}`,
            chatId,
          });
          if (response) {
            await this.sendMessageTo(chatId, response);
          }
        } finally {
          clearInterval(typingInterval);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Telegram] Photo error:', errorMsg);
        await ctx.reply(`Photo error: ${errorMsg}`);
      }
    });

    // Handle errors
    this.bot.catch(err => {
      display.appendAssistantMessage(formatToolAction('Telegram', 'error', { success: false, summary: String(err) }));
    });
  }

  /**
   * Set the handler that processes incoming messages
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set the event bus for emitting connector events
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * Start the Telegram bot (polling mode)
   * Only one instance can run at a time
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Try to acquire lock - only one instance can run Telegram
    const lock = await acquireLock('telegram');
    if (!lock.acquired) {
      display.appendAssistantMessage(
        formatToolAction('Telegram', 'locked', { success: false, summary: `PID ${lock.existingPid}${lock.existingWorkDir ? ` in ${lock.existingWorkDir}` : ''}` }),
      );
      return;
    }

    try {
      // Clear pending updates to avoid processing old messages on startup
      // Use AbortController for timeout
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
          `https://api.telegram.org/bot${this.bot.telegram.token}/getUpdates?offset=-1`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);

        const data = (await response.json()) as {
          ok: boolean;
          result: Array<{ update_id: number }>;
        };
        if (data.ok && data.result.length > 0) {
          const lastUpdateId = data.result[data.result.length - 1].update_id;
          // Mark all updates as read
          const controller2 = new AbortController();
          const timeout2 = setTimeout(() => controller2.abort(), 3000);
          await fetch(
            `https://api.telegram.org/bot${this.bot.telegram.token}/getUpdates?offset=${lastUpdateId + 1}`,
            { signal: controller2.signal },
          );
          clearTimeout(timeout2);
        }
      } catch {
        // Ignore errors - bot will still work
      }

      // Launch bot in background (non-blocking)
      this.bot.launch().catch(err => {
        display.appendAssistantMessage(formatToolAction('Telegram', 'error', { success: false, summary: String(err) }));
        releaseLock('telegram');
        if (this.eventBus) {
          this.eventBus.emit({ type: 'connector:disconnected', source: 'telegram' });
        }
      });

      this.running = true;
      if (this.eventBus) {
        this.eventBus.emit({ type: 'connector:connected', source: 'telegram' });
      }
    } catch (error) {
      await releaseLock('telegram');
      display.appendAssistantMessage(formatToolAction('Telegram', 'error', { success: false, summary: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }

  /**
   * Stop the Telegram bot
   */
  stop(): void {
    if (!this.running) return;
    this.bot.stop('SIGINT');
    this.running = false;
    // Release lock asynchronously
    releaseLock('telegram').catch(() => {});
    if (this.eventBus) {
      this.eventBus.emit({ type: 'connector:disconnected', source: 'telegram' });
    }
  }

  /**
   * Send a message to a specific chat
   */
  async sendMessageTo(chatId: string, text: string): Promise<void> {
    if (!this.running) {
      throw new Error('Telegram bot not running');
    }

    const chunks = splitMessage(text, this.config.maxMessageLength);
    for (const chunk of chunks) {
      await this.bot.telegram
        .sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
        })
        .catch(async () => {
          // Fallback to plain text if markdown fails
          await this.bot.telegram.sendMessage(chatId, chunk);
        });
    }
  }

  /**
   * Send a message to the current reply target (same chat that sent the last message)
   */
  async sendMessage(text: string): Promise<void> {
    return this.sendMessageTo(this.replyTargetChatId, text);
  }

  isRunning(): boolean {
    return this.running;
  }

  getCapabilities(): ConnectorCapabilities {
    return (
      getConnectorCapabilities(this.source) ?? {
        chatTypes: ['direct'],
        supportsMarkdown: true,
        supportsReactions: false,
        supportsEdit: false,
        supportsDelete: false,
        supportsThreads: false,
        supportsTyping: true,
        supportsVoiceInbound: false,
        supportsImageInbound: false,
        supportsMultiTarget: false,
      }
    );
  }

  listSupportedActions(): ConnectorActionSpec[] {
    return getConnectorActionSpecs(this.source);
  }

  getStatus(): ConnectorStatus {
    const authorizedTargets = Array.from(this.authorizedChatIds);
    return {
      source: this.source,
      configured: true,
      running: this.running,
      primaryTarget: this.primaryChatId,
      activeTarget: this.replyTargetChatId,
      authorizedTargets,
      notes: this.running
        ? [`${authorizedTargets.length} authorized chat(s)`]
        : ['Configured but not running'],
    };
  }
}

/**
 * Factory function to create a Telegram connector
 */
export function createTelegramConnector(config: TelegramConfig): TelegramConnector {
  return new TelegramConnector(config);
}
