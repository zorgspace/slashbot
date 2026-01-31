/**
 * Discord Connector for Slashbot
 *
 * RULES:
 * - Messages are only accepted from the authorized channelId
 * - Responses are ALWAYS sent back to the same channel that sent the message
 * - Voice attachments (ogg/mp3/wav) are transcribed and processed as text
 * - Max message length: 2000 chars (auto-split if longer)
 */

import { Client, GatewayIntentBits, Message as DiscordMessage } from 'discord.js';
import { c } from '../ui/colors';
import { Connector, MessageHandler, PLATFORM_CONFIGS, splitMessage } from './base';
import { getTranscriptionService } from '../services/transcription';
import { imageBuffer } from '../code/imageBuffer';

export interface DiscordConfig {
  botToken: string;
  channelId: string; // Authorized channel ID
}

export class DiscordConnector implements Connector {
  readonly source = 'discord' as const;
  readonly config = PLATFORM_CONFIGS.discord;

  private client: Client;
  private channelId: string;
  private replyTargetChannelId: string; // Track where to send replies
  private messageHandler: MessageHandler | null = null;
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
    this.channelId = config.channelId;
    this.replyTargetChannelId = config.channelId; // Default to configured channelId
    this.setupHandlers(config.botToken);
  }

  private setupHandlers(token: string): void {
    this.client.once('ready', () => {
      console.log(c.success(`[Discord] Connected as ${this.client.user?.tag}`));
    });

    this.client.on('messageCreate', async (message: DiscordMessage) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only respond in authorized channel
      if (message.channelId !== this.channelId) return;

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
          const imageAttachments = message.attachments.filter(att =>
            att.contentType?.startsWith('image/') ||
            att.name?.match(/\.(png|jpg|jpeg|gif|webp)$/i)
          );

          // Process images and add to context
          for (const imgAtt of imageAttachments.values()) {
            try {
              console.log(c.muted('[Discord] Downloading image...'));
              const imageResponse = await fetch(imgAtt.url);
              const imageBuffer64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
              const mimeType = imgAtt.contentType || 'image/jpeg';
              const dataUrl = `data:${mimeType};base64,${imageBuffer64}`;
              imageBuffer.push(dataUrl);
              console.log(c.muted(`[Discord] Image added to context (${Math.round(imageBuffer64.length / 1024)}KB)`));
            } catch (imgErr) {
              console.log(c.error(`[Discord] Failed to download image: ${imgErr}`));
            }
          }

          // Check for voice message attachments (Discord voice messages are ogg files)
          const voiceAttachment = message.attachments.find(att =>
            att.contentType?.startsWith('audio/') ||
            att.name?.endsWith('.ogg') ||
            att.name?.endsWith('.mp3') ||
            att.name?.endsWith('.wav')
          );

          if (voiceAttachment) {
            const transcriptionService = getTranscriptionService();
            if (!transcriptionService) {
              await message.reply('Voice transcription not configured. Set OPENAI_API_KEY.');
              return;
            }

            console.log(c.muted('[Discord] Transcribing voice message...'));
            const result = await transcriptionService.transcribeFromUrl(voiceAttachment.url);

            if (!result || !result.text) {
              await message.reply('Could not transcribe voice message');
              return;
            }

            console.log(c.muted(`[Discord] Voice: "${result.text.slice(0, 50)}..."`));
            textContent = result.text;
          }

          // If only images and no text, use default prompt
          if (!textContent && imageAttachments.size > 0) {
            textContent = 'What is in this image?';
          }

          if (!textContent) return;

          // Process message
          const response = await this.messageHandler(textContent, 'discord');

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

    this.client.on('error', (err) => {
      console.log(c.error(`[Discord] Error: ${err.message}`));
    });

    // Store token for start()
    (this.client as any)._token = token;
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (this.running) return;

    try {
      await this.client.login((this.client as any)._token);
      this.running = true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(c.error(`[Discord] Failed to start: ${errorMsg}`));
      throw error;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.client.destroy();
    this.running = false;
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
}

export function createDiscordConnector(config: DiscordConfig): DiscordConnector {
  return new DiscordConnector(config);
}
