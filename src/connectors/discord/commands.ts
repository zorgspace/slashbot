/**
 * Discord Commands
 */

import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

export const discordCommand: CommandHandler = {
  name: 'discord',
  description: 'Configure Discord bot connection',
  usage: '/discord <bot_token> <channel_id>',
  group: 'Connectors',
  execute: async (args, context) => {
    const botToken = args[0];
    const channelId = args[1];

    if (!botToken) {
      const discordConfig = context.configManager.getDiscordConfig();
      const connector = context.connectors.get('discord');

      display.append('');
      display.violet('Discord Configuration');
      display.append('');

      if (discordConfig) {
        display.append('  Status:     ' + (connector?.isRunning() ? 'Connected' : 'Configured but not running'));
        display.muted('  Bot:        ' + discordConfig.botToken.slice(0, 20) + '...');
        display.muted('  Channel ID: ' + discordConfig.channelId);
      } else {
        display.append('  Status:  Not configured');
      }

      display.append('');
      display.muted('Usage:');
      display.append('  /discord <bot_token> <channel_id> - Configure bot');
      display.append('  /discord clear                    - Remove configuration');
      display.append('');
      display.muted('Get bot token from Discord Developer Portal');
      display.muted('Channel ID: Right-click channel > Copy ID (enable Developer Mode)');
      display.append('');
      return true;
    }

    if (botToken === 'clear') {
      await context.configManager.clearDiscordConfig();
      const connector = context.connectors.get('discord');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('discord');
      }
      display.successText('Discord configuration cleared');
      return true;
    }

    if (!channelId) {
      display.errorText('Channel ID required');
      display.muted('Usage: /discord <bot_token> <channel_id>');
      display.muted('Get Channel ID: Right-click channel > Copy ID');
      return true;
    }

    try {
      await context.configManager.saveDiscordConfig(botToken, channelId);
      display.successText('Discord configured!');
      display.muted('Bot token: ' + botToken.slice(0, 20) + '...');
      display.muted('Channel ID: ' + channelId);
      display.warningText('Restart slashbot to connect to Discord');
    } catch (error) {
      display.errorText('Error saving config: ' + error);
    }

    return true;
  },
};

export const discordCommands: CommandHandler[] = [discordCommand];
