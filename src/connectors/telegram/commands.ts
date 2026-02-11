/**
 * Telegram Commands
 */

import { display } from '../../core/ui';
import { fg } from '@opentui/core';
import { theme } from '../../core/ui/theme';
import type { CommandHandler } from '../../core/commands/registry';

export const telegramCommand: CommandHandler = {
  name: 'telegram',
  description: 'Configure Telegram bot connection',
  usage: '/telegram <bot_token> [chat_id]',
  group: 'Connectors',
  subcommands: ['add', 'remove', 'clear'],
  execute: async (args, context) => {
    const botToken = args[0];
    const chatId = args[1];

    if (!botToken) {
      const telegramConfig = context.configManager.getTelegramConfig();
      const connector = context.connectors.get('telegram');

      const statusBlock = `${fg(theme.accent)('Telegram Configuration')}

${
  telegramConfig
    ? `
  Status:  ${connector?.isRunning() ? fg(theme.success)('Connected') : fg(theme.warning)('Configured but not running')}
  Bot:     ${fg(theme.muted)(telegramConfig.botToken.slice(0, 10) + '...')}
  Chat ID: ${fg(theme.muted)(telegramConfig.chatId + ' (primary)')}
${telegramConfig.chatIds && telegramConfig.chatIds.length > 0 ? fg(theme.muted)('  Additional: ' + telegramConfig.chatIds.join(', ')) + '\\n' : ''}
`
    : fg(theme.muted)('  Status:  Not configured') + '\\n'
}

${fg(theme.muted)('Usage:')}
  /telegram <bot_token> <chat_id> - Configure bot
  /telegram <bot_token>           - Auto-detect chat_id
  /telegram add <chat_id>         - Add authorized chat
  /telegram remove <chat_id>      - Remove authorized chat
  /telegram clear                 - Remove configuration

${fg(theme.muted)('Get bot token from @BotFather on Telegram')}
`;
      display.append(statusBlock);
      return true;
    }

    if (botToken === 'add') {
      if (!chatId) {
        display.errorText('Usage: /telegram add <chat_id>');
        return true;
      }
      try {
        await context.configManager.addTelegramChat(chatId);
        display.successText('Added chat ' + chatId + ' to authorized list');
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (botToken === 'remove') {
      if (!chatId) {
        display.errorText('Usage: /telegram remove <chat_id>');
        return true;
      }
      try {
        await context.configManager.removeTelegramChat(chatId);
        display.successText('Removed chat ' + chatId + ' from authorized list');
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
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
          display.warningText(
            'No messages found. Send a message to your bot first, then run this command again.',
          );
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
