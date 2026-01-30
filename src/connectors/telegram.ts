/**
 * Telegram Connector for Slashbot
 *
 * RULES:
 * - Messages are only accepted from the authorized chatId
 * - Responses are ALWAYS sent back to the same chatId that sent the message
 * - Voice messages are transcribed and processed as text
 * - Max message length: 4000 chars (auto-split if longer)
 */

import { Telegraf } from 'telegraf';
import { c } from '../ui/colors';
import { Connector, MessageHandler, PLATFORM_CONFIGS, splitMessage } from './base';
import { getTranscriptionService } from '../services/transcription';

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
    this.bot.on('text', async (ctx) => {
      const message = ctx.message.text;

      if (!this.messageHandler) {
        await ctx.reply('Bot not fully initialized');
        return;
      }

      // Track the chat to reply to (same chat that sent the message)
      this.replyTargetChatId = ctx.chat.id.toString();

      try {
        // Send typing indicator
        await ctx.sendChatAction('typing');

        // Process message through slashbot
        const response = await this.messageHandler(message, 'telegram');

        // Send response if any
        if (response) {
          await this.sendMessage(response);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`Error: ${errorMsg}`);
      }
    });

    // Handle voice messages
    this.bot.on('voice', async (ctx) => {
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
        await ctx.sendChatAction('typing');

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
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`Voice error: ${errorMsg}`);
      }
    });

    // Handle errors
    this.bot.catch((err) => {
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
   */
  async start(): Promise<void> {
    if (this.running) return;

    try {
      await this.bot.launch();
      this.running = true;
      console.log(c.success('[Telegram] Connected'));
    } catch (error) {
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
      await this.bot.telegram.sendMessage(targetChat, chunk, {
        parse_mode: 'Markdown',
      }).catch(async () => {
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
