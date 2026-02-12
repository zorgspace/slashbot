/**
 * Telegram Commands
 */

import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

function dedupe(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
}

function renderTelegramStatus(context: Parameters<CommandHandler['execute']>[1]): void {
  const telegramConfig = context.configManager.getTelegramConfig();
  const connector = context.connectors.get('telegram');
  const runtime = connector?.getStatus?.();

  const configuredTargets = telegramConfig
    ? dedupe([telegramConfig.chatId, ...(telegramConfig.chatIds || [])])
    : [];
  const runtimeTargets = runtime?.authorizedTargets?.length
    ? runtime.authorizedTargets
    : configuredTargets;

  const lines = [
    'Telegram Configuration',
    '',
    telegramConfig
      ? `Status:      ${runtime?.running || connector?.isRunning() ? 'Connected' : 'Configured but not running'}`
      : 'Status:      Not configured',
  ];

  if (telegramConfig) {
    lines.push(`Bot:         ${telegramConfig.botToken.slice(0, 10)}...`);
    lines.push(`Primary chat: ${runtime?.primaryTarget || telegramConfig.chatId}`);
    lines.push(`Active chat:  ${runtime?.activeTarget || telegramConfig.chatId}`);
    lines.push(`Authorized:   ${runtimeTargets.length > 0 ? runtimeTargets.join(', ') : '(none)'}`);
  }

  lines.push(
    '',
    'Usage:',
    '/telegram <bot_token> <chat_id> - Configure bot',
    '/telegram <bot_token>           - Auto-detect chat_id',
    '/telegram add <chat_id>         - Add authorized chat',
    '/telegram remove <chat_id>      - Remove authorized chat',
    '/telegram primary <chat_id>     - Set primary chat',
    '/telegram clear                 - Remove configuration',
    '',
    'Get bot token from @BotFather on Telegram',
  );

  display.renderMarkdown(lines.join('\n'), true);
}

export const telegramCommand: CommandHandler = {
  name: 'telegram',
  description: 'Configure Telegram bot connection',
  usage: '/telegram <bot_token> [chat_id]',
  group: 'Connectors',
  subcommands: ['add', 'remove', 'primary', 'clear'],
  execute: async (args, context) => {
    const arg0 = args[0];
    const arg1 = args[1];

    if (!arg0) {
      renderTelegramStatus(context);
      return true;
    }

    if (arg0 === 'add') {
      if (!arg1) {
        display.errorText('Usage: /telegram add <chat_id>');
        return true;
      }
      try {
        await context.configManager.addTelegramChat(arg1);
        display.successText(`Added chat ${arg1} to authorized list`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'remove') {
      if (!arg1) {
        display.errorText('Usage: /telegram remove <chat_id>');
        return true;
      }
      try {
        await context.configManager.removeTelegramChat(arg1);
        display.successText(`Removed chat ${arg1} from authorized list`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'primary') {
      if (!arg1) {
        display.errorText('Usage: /telegram primary <chat_id>');
        return true;
      }
      try {
        await context.configManager.setTelegramPrimaryChat(arg1);
        display.successText(`Primary Telegram chat updated to ${arg1}`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'clear') {
      await context.configManager.clearTelegramConfig();
      const connector = context.connectors.get('telegram');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('telegram');
      }
      display.successText('Telegram configuration cleared');
      return true;
    }

    const botToken = arg0;
    let finalChatId = arg1;

    if (!botToken.includes(':')) {
      display.errorText('Invalid bot token format');
      display.muted('Token should be like: 123456789:ABCdefGHI...');
      return true;
    }

    if (!finalChatId) {
      display.muted('Fetching chat_id from Telegram...');
      display.muted('(Send at least one message to your bot first)');

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

        const update = data.result?.find(item => item.message?.chat?.id);
        if (update?.message?.chat?.id) {
          finalChatId = String(update.message.chat.id);
          display.successText(`Found chat_id: ${finalChatId}`);
        } else {
          display.warningText(
            'No messages found. Send a message to your bot first, then run this command again.',
          );
          return true;
        }
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
        return true;
      }
    }

    const existing = context.configManager.getTelegramConfig();
    const previousTargets = dedupe([
      ...(existing ? [existing.chatId] : []),
      ...(existing?.chatIds || []),
    ]);
    const retainedSecondary = dedupe(previousTargets.filter(id => id !== finalChatId));

    try {
      await context.configManager.saveTelegramConfig(botToken, finalChatId, retainedSecondary);
      display.successText('Telegram configured!');
      display.muted('Bot token: ' + botToken.slice(0, 10) + '...');
      display.muted('Primary chat ID: ' + finalChatId);
      if (retainedSecondary.length > 0) {
        display.muted('Additional chat IDs: ' + retainedSecondary.join(', '));
      }
      display.warningText('Restart slashbot to connect to Telegram');
    } catch (error) {
      display.errorText('Error saving config: ' + (error instanceof Error ? error.message : String(error)));
    }

    return true;
  },
};

export const telegramCommands: CommandHandler[] = [telegramCommand];
