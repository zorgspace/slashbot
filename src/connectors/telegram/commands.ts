/**
 * Telegram Commands
 */

import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

export const telegramCommand: CommandHandler = {
  name: 'telegram',
  description: 'Configure Telegram bot connection',
  usage: '/telegram <bot_token> [chat_id]',
  group: 'Connectors',
  execute: async (args, context) => {
    const botToken = args[0];
    const chatId = args[1];

    if (!botToken) {
      const telegramConfig = context.configManager.getTelegramConfig();
      const connector = context.connectors.get('telegram');

      display.append('');
      display.violet('Telegram Configuration');
      display.append('');

      if (telegramConfig) {
        display.append('  Status:  ' + (connector?.isRunning() ? 'Connected' : 'Configured but not running'));
        display.muted('  Bot:     ' + telegramConfig.botToken.slice(0, 10) + '...');
        display.muted('  Chat ID: ' + telegramConfig.chatId);
      } else {
        display.append('  Status:  Not configured');
      }

      display.append('');
      display.muted('Usage:');
      display.append('  /telegram <bot_token> <chat_id> - Configure bot');
      display.append('  /telegram <bot_token>           - Auto-detect chat_id');
      display.append('  /telegram clear                 - Remove configuration');
      display.append('');
      display.muted('Get bot token from @BotFather on Telegram');
      display.append('');
      return true;
    }

    if (botToken === 'clear') {
      await context.configManager.clearTelegramConfig();
      const connector = context.connectors.get('telegram');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('telegram');
      }
      display.successText('Telegram configuration cleared');
      return true;
    }

    if (!botToken.includes(':')) {
      display.errorText('Invalid bot token format');
      display.muted('Token should be like: 123456789:ABCdefGHI...');
      return true;
    }

    let finalChatId = chatId;

    if (!finalChatId) {
      display.muted('Fetching chat_id from Telegram...');
      display.muted('(Make sure you sent a message to your bot first)');

      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
        const data = (await response.json()) as {
          ok: boolean;
          result: Array<{ message?: { chat?: { id: number } } }>;
        };

        if (!data.ok) {
          display.errorText('Invalid bot token');
          return true;
        }

        const update = data.result?.find((u: any) => u.message?.chat?.id);
        if (update?.message?.chat?.id) {
          finalChatId = String(update.message.chat.id);
          display.successText('Found chat_id: ' + finalChatId);
        } else {
          display.warningText('No messages found. Send a message to your bot first, then run this command again.');
          return true;
        }
      } catch (error) {
        display.errorText('Error: ' + error);
        return true;
      }
    }

    try {
      await context.configManager.saveTelegramConfig(botToken, finalChatId);
      display.successText('Telegram configured!');
      display.muted('Bot token: ' + botToken.slice(0, 10) + '...');
      display.muted('Chat ID: ' + finalChatId);
      display.warningText('Restart slashbot to connect to Telegram');
    } catch (error) {
      display.errorText('Error saving config: ' + error);
    }

    return true;
  },
};

export const telegramCommands: CommandHandler[] = [telegramCommand];
