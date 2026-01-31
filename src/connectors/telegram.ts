/**
 * Telegram Connector for Slashbot
 *
 * RULES:
 * - Messages are only accepted from the authorized chatId
 * - Responses are ALWAYS sent back to the same chatId that sent the message
 * - Voice messages are transcribed and processed as text
 * - Max message length: 4000 chars (auto-split if longer)
 * - Only one instance can run Telegram at a time (uses lock file)
 */

import { Telegraf } from 'telegraf';
import { c } from '../ui/colors';
import { Connector, MessageHandler, PLATFORM_CONFIGS, splitMessage } from './base';
import { getTranscriptionService } from '../services/transcription';
import { imageBuffer } from '../code/imageBuffer';
import { acquireLock, releaseLock } from './locks';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramConnector implements Connector {
  readonly source = 'telegram' as const;
  readonly config = PLATFORM_CONFIGS.telegram;

  private bot: Telegraf;
  private chatId: string;
  private replyTargetChatId: string; // Track where to send replies
  private messageHandler: MessageHandler | null = null;
  private running = false;

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.chatId = config.chatId;
    this.replyTargetChatId = config.chatId; // Default to configured chatId
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Only accept messages from the authorized chat
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id?.toString();
      if (chatId !== this.chatId) {
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

      // Track the chat to reply to (same chat that sent the message)
      this.replyTargetChatId = ctx.chat.id.toString();

      try {
        // Start continuous typing indicator (Telegram typing expires after ~5s)
        const chatId = ctx.chat.id;
        await this.bot.telegram.sendChatAction(chatId, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
        }, 4000);

        // Process message through slashbot
        let response: string | void;
        try {
          response = await this.messageHandler(message, 'telegram');
        } finally {
          clearInterval(typingInterval);
        }

        // Send response if any (using sendMessage which handles splitting)
        if (response) {
          await this.sendMessage(response);
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

      // Track the chat to reply to (same chat that sent the message)
      this.replyTargetChatId = ctx.chat.id.toString();

      const transcriptionService = getTranscriptionService();
      if (!transcriptionService) {
        await ctx.reply('Voice transcription not configured. Set OPENAI_API_KEY.');
        return;
      }

      try {
        // Start continuous typing indicator
        const chatId = ctx.chat.id;
        await this.bot.telegram.sendChatAction(chatId, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
        }, 4000);

        try {
          // Get file URL from Telegram
          const fileId = ctx.message.voice.file_id;
          const file = await ctx.telegram.getFile(fileId);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.telegram.token}/${file.file_path}`;

          // Transcribe
          console.log(c.muted('[Telegram] Transcribing voice message...'));
          const result = await transcriptionService.transcribeFromUrl(fileUrl);

          if (!result || !result.text) {
            await ctx.reply('Could not transcribe voice message');
            return;
          }

          console.log(c.muted(`[Telegram] Voice: "${result.text.slice(0, 50)}..."`));

          // Process transcribed text
          const response = await this.messageHandler(result.text, 'telegram');
          if (response) {
            await this.sendMessage(response);
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

      // Track the chat to reply to
      this.replyTargetChatId = ctx.chat.id.toString();

      try {
        // Start continuous typing indicator
        const chatId = ctx.chat.id;
        await this.bot.telegram.sendChatAction(chatId, 'typing');
        const typingInterval = setInterval(() => {
          this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
        }, 4000);

        try {
          // Get the largest photo (last in array)
          const photos = ctx.message.photo;
          const largestPhoto = photos[photos.length - 1];
          const file = await ctx.telegram.getFile(largestPhoto.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.telegram.token}/${file.file_path}`;

          // Download and convert to base64 data URL
          console.log(c.muted('[Telegram] Downloading image...'));
          const imageResponse = await fetch(fileUrl);
          const imageBuffer64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
          const mimeType = file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${imageBuffer64}`;

          // Add to image buffer for vision context
          imageBuffer.push(dataUrl);
          console.log(
            c.muted(
              `[Telegram] Image added to context (${Math.round(imageBuffer64.length / 1024)}KB)`,
            ),
          );

          // Use caption or default prompt
          const message = ctx.message.caption || 'What is in this image?';

          // Process with the image in context
          const response = await this.messageHandler(message, 'telegram');
          if (response) {
            await this.sendMessage(response);
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
      console.log(c.error(`[Telegram] Error: ${err}`));
    });
  }

  /**
   * Set the handler that processes incoming messages
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
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
      console.log(c.warning(`[Telegram] Another instance is already running (PID ${lock.existingPid})`));
      if (lock.existingWorkDir) {
        console.log(c.muted(`  Running in: ${lock.existingWorkDir}`));
      }
      console.log(c.muted(`  Telegram connector disabled for this instance`));
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
        console.log(c.error(`[Telegram] Error: ${err}`));
        releaseLock('telegram');
      });

      this.running = true;
    } catch (error) {
      await releaseLock('telegram');
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(c.error(`[Telegram] Failed to start: ${errorMsg}`));
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
  }

  /**
   * Send a message to the current reply target (same chat that sent the last message)
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.running) {
      throw new Error('Telegram bot not running');
    }

    const targetChat = this.replyTargetChatId;
    const chunks = splitMessage(text, this.config.maxMessageLength);
    for (const chunk of chunks) {
      await this.bot.telegram
        .sendMessage(targetChat, chunk, {
          parse_mode: 'Markdown',
        })
        .catch(async () => {
          // Fallback to plain text if markdown fails
          await this.bot.telegram.sendMessage(targetChat, chunk);
        });
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Factory function to create a Telegram connector
 */
export function createTelegramConnector(config: TelegramConfig): TelegramConnector {
  return new TelegramConnector(config);
}
