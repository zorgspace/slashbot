/**
 * Discord Commands
 */

import { display } from '../../core/ui';
import { fg } from '@opentui/core';
import { theme } from '../../core/ui/theme';
import type { CommandHandler } from '../../core/commands/registry';

export const discordCommand: CommandHandler = {
  name: 'discord',
  description: 'Configure Discord bot connection',
  usage: '/discord <bot_token> <channel_id>',
  group: 'Connectors',
  subcommands: ['clear'],
  execute: async (args, context) => {
    const botToken = args[0];
    const channelId = args[1];

    if (!botToken) {
      const discordConfig = context.configManager.getDiscordConfig();
      const connector = context.connectors.get('discord');

      const statusBlock = `${fg(theme.accent)('Discord Configuration')}

${
  discordConfig
    ? `
  Status:     ${connector?.isRunning() ? fg(theme.success)('Connected') : fg(theme.warning)('Configured but not running')}
  Bot:        ${fg(theme.muted)(discordConfig.botToken.slice(0, 20) + '...')}
  Channel ID: ${fg(theme.muted)(discordConfig.channelId)}
`
    : fg(theme.muted)('  Status:  Not configured') + '\\n'
}

${fg(theme.muted)('Usage:')}
  /discord <bot_token> <channel_id> - Configure bot
  /discord clear                    - Remove configuration

${fg(theme.muted)('Get bot token from Discord Developer Portal')}
${fg(theme.muted)('Channel ID: Right-click channel > Copy ID (enable Developer Mode)')}
`;
      display.append(statusBlock);
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
