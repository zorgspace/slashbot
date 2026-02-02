/**
 * Connector Command Handlers - telegram, discord
 */

import { c } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const telegramCommand: CommandHandler = {
  name: 'telegram',
  description: 'Configure Telegram bot connection',
  usage: '/telegram <bot_token> [chat_id]',
  execute: async (args, context) => {
    const botToken = args[0];
    const chatId = args[1];

    if (!botToken) {
      const telegramConfig = context.configManager.getTelegramConfig();
      const connector = context.connectors.get('telegram');

      console.log(`\n${c.violet('Telegram Configuration')}\n`);

      if (telegramConfig) {
        console.log(
          `  ${c.muted('Status:')}  ${connector?.isRunning() ? c.success('Connected') : c.warning('Configured but not running')}`,
        );
        console.log(`  ${c.muted('Bot:')}     ${telegramConfig.botToken.slice(0, 10)}...`);
        console.log(`  ${c.muted('Chat ID:')} ${telegramConfig.chatId}`);
      } else {
        console.log(`  ${c.muted('Status:')}  ${c.warning('Not configured')}`);
      }

      console.log(`\n${c.muted('Usage:')}`);
      console.log(`  ${c.violet('/telegram <bot_token> <chat_id>')} - Configure bot`);
      console.log(`  ${c.violet('/telegram <bot_token>')}           - Auto-detect chat_id`);
      console.log(`  ${c.violet('/telegram clear')}                 - Remove configuration`);
      console.log(`\n${c.muted('Get bot token from @BotFather on Telegram')}\n`);
      return true;
    }

    if (botToken === 'clear') {
      await context.configManager.clearTelegramConfig();
      const connector = context.connectors.get('telegram');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('telegram');
      }
      console.log(c.success('Telegram configuration cleared'));
      return true;
    }

    if (!botToken.includes(':')) {
      console.log(c.error('Invalid bot token format'));
      console.log(c.muted('Token should be like: 123456789:ABCdefGHI...'));
      return true;
    }

    let finalChatId = chatId;

    if (!finalChatId) {
      console.log(c.muted('Fetching chat_id from Telegram...'));
      console.log(c.muted('(Make sure you sent a message to your bot first)'));

      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
        const data = (await response.json()) as {
          ok: boolean;
          result: Array<{ message?: { chat?: { id: number } } }>;
        };

        if (!data.ok) {
          console.log(c.error('Invalid bot token'));
          return true;
        }

        const update = data.result?.find((u: any) => u.message?.chat?.id);
        if (update?.message?.chat?.id) {
          finalChatId = String(update.message.chat.id);
          console.log(c.success(`Found chat_id: ${finalChatId}`));
        } else {
          console.log(
            c.warning(
              'No messages found. Send a message to your bot first, then run this command again.',
            ),
          );
          return true;
        }
      } catch (error) {
        console.log(c.error(`Error: ${error}`));
        return true;
      }
    }

    try {
      await context.configManager.saveTelegramConfig(botToken, finalChatId);
      console.log(c.success('Telegram configured!'));
      console.log(c.muted(`Bot token: ${botToken.slice(0, 10)}...`));
      console.log(c.muted(`Chat ID: ${finalChatId}`));
      console.log(c.warning('\nRestart slashbot to connect to Telegram'));
    } catch (error) {
      console.log(c.error(`Error saving config: ${error}`));
    }

    return true;
  },
};

export const discordCommand: CommandHandler = {
  name: 'discord',
  description: 'Configure Discord bot connection',
  usage: '/discord <bot_token> <channel_id>',
  execute: async (args, context) => {
    const botToken = args[0];
    const channelId = args[1];

    if (!botToken) {
      const discordConfig = context.configManager.getDiscordConfig();
      const connector = context.connectors.get('discord');

      console.log(`\n${c.violet('Discord Configuration')}\n`);

      if (discordConfig) {
        console.log(
          `  ${c.muted('Status:')}     ${connector?.isRunning() ? c.success('Connected') : c.warning('Configured but not running')}`,
        );
        console.log(`  ${c.muted('Bot:')}        ${discordConfig.botToken.slice(0, 20)}...`);
        console.log(`  ${c.muted('Channel ID:')} ${discordConfig.channelId}`);
      } else {
        console.log(`  ${c.muted('Status:')}  ${c.warning('Not configured')}`);
      }

      console.log(`\n${c.muted('Usage:')}`);
      console.log(`  ${c.violet('/discord <bot_token> <channel_id>')} - Configure bot`);
      console.log(`  ${c.violet('/discord clear')}                    - Remove configuration`);
      console.log(`\n${c.muted('Get bot token from Discord Developer Portal')}`);
      console.log(
        `${c.muted('Channel ID: Right-click channel > Copy ID (enable Developer Mode)')}\n`,
      );
      return true;
    }

    if (botToken === 'clear') {
      await context.configManager.clearDiscordConfig();
      const connector = context.connectors.get('discord');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('discord');
      }
      console.log(c.success('Discord configuration cleared'));
      return true;
    }

    if (!channelId) {
      console.log(c.error('Channel ID required'));
      console.log(c.muted('Usage: /discord <bot_token> <channel_id>'));
      console.log(c.muted('Get Channel ID: Right-click channel > Copy ID'));
      return true;
    }

    try {
      await context.configManager.saveDiscordConfig(botToken, channelId);
      console.log(c.success('Discord configured!'));
      console.log(c.muted(`Bot token: ${botToken.slice(0, 20)}...`));
      console.log(c.muted(`Channel ID: ${channelId}`));
      console.log(c.warning('\nRestart slashbot to connect to Discord'));
    } catch (error) {
      console.log(c.error(`Error saving config: ${error}`));
    }

    return true;
  },
};

export const connectorHandlers: CommandHandler[] = [telegramCommand, discordCommand];
