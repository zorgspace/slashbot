/**
 * Discord Commands
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

function renderDiscordStatus(context: Parameters<CommandHandler['execute']>[1]): void {
  const discordConfig = context.configManager.getDiscordConfig();
  const connector = context.connectors.get('discord');
  const runtime = connector?.getStatus?.();

  const configuredTargets = discordConfig
    ? dedupe([discordConfig.channelId, ...(discordConfig.channelIds ?? [])])
    : [];
  const runtimeTargets = runtime?.authorizedTargets?.length
    ? runtime.authorizedTargets
    : configuredTargets;
  const ownerId = runtime?.ownerId ?? discordConfig?.ownerId ?? '(not set)';

  const lines = [
    'Discord Configuration',
    '',
    discordConfig
      ? `Status:         ${runtime?.running || connector?.isRunning() ? 'Connected' : 'Configured but not running'}`
      : 'Status:         Not configured',
  ];

  if (discordConfig) {
    lines.push(`Bot:            ${discordConfig.botToken.slice(0, 20)}...`);
    lines.push(`Primary channel: ${runtime?.primaryTarget ?? discordConfig.channelId}`);
    lines.push(`Active channel:  ${runtime?.activeTarget ?? discordConfig.channelId}`);
    lines.push(`Authorized:      ${runtimeTargets.length > 0 ? runtimeTargets.join(', ') : '(none)'}`);
    lines.push(`Owner user id:   ${ownerId}`);
  }

  lines.push(
    '',
    'Usage:',
    '/discord <bot_token> <channel_id> - Configure bot',
    '/discord add <channel_id>         - Add authorized channel',
    '/discord remove <channel_id>      - Remove authorized channel',
    '/discord primary <channel_id>     - Set primary channel',
    '/discord owner <user_id>          - Set owner user id (for private threads)',
    '/discord owner clear              - Clear owner user id',
    '/discord clear                    - Remove configuration',
    '',
    'Get bot token from Discord Developer Portal',
    'Channel ID: Right-click channel > Copy ID (Developer Mode enabled)',
  );

  display.renderMarkdown(lines.join('\n'), true);
}

export const discordCommand: CommandHandler = {
  name: 'discord',
  description: 'Configure Discord bot connection',
  usage: '/discord <bot_token> <channel_id>',
  group: 'Connectors',
  subcommands: ['add', 'remove', 'primary', 'owner', 'clear'],
  execute: async (args, context) => {
    const arg0 = args[0];
    const arg1 = args[1];

    if (!arg0) {
      renderDiscordStatus(context);
      return true;
    }

    if (arg0 === 'clear') {
      await context.configManager.clearDiscordConfig();
      const connector = context.connectors.get('discord');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('discord');
      }
      display.successText('Discord configuration cleared');
      return true;
    }

    if (arg0 === 'add') {
      if (!arg1) {
        display.errorText('Usage: /discord add <channel_id>');
        return true;
      }
      try {
        await context.configManager.addDiscordChannel(arg1);
        display.successText(`Added channel ${arg1} to authorized list`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'remove') {
      if (!arg1) {
        display.errorText('Usage: /discord remove <channel_id>');
        return true;
      }
      try {
        await context.configManager.removeDiscordChannel(arg1);
        display.successText(`Removed channel ${arg1} from authorized list`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'primary') {
      if (!arg1) {
        display.errorText('Usage: /discord primary <channel_id>');
        return true;
      }
      try {
        await context.configManager.setDiscordPrimaryChannel(arg1);
        display.successText(`Primary Discord channel updated to ${arg1}`);
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    if (arg0 === 'owner') {
      if (!arg1) {
        display.errorText('Usage: /discord owner <user_id>');
        display.muted('Use /discord owner clear to remove owner id');
        return true;
      }
      const cfg = context.configManager.getDiscordConfig();
      if (!cfg) {
        display.errorText('Discord not configured yet');
        return true;
      }
      try {
        if (arg1 === 'clear') {
          await context.configManager.saveDiscordConfig(
            cfg.botToken,
            cfg.channelId,
            cfg.channelIds,
            undefined,
          );
          display.successText('Discord owner user id cleared');
        } else {
          await context.configManager.setDiscordOwnerId(arg1);
          display.successText(`Discord owner user id set to ${arg1}`);
        }
        display.warningText('Restart slashbot to apply changes');
      } catch (error) {
        display.errorText('Error: ' + (error instanceof Error ? error.message : String(error)));
      }
      return true;
    }

    const botToken = arg0;
    const channelId = arg1;

    if (!channelId) {
      display.errorText('Channel ID required');
      display.muted('Usage: /discord <bot_token> <channel_id>');
      display.muted('Get Channel ID: Right-click channel > Copy ID');
      return true;
    }

    const existing = context.configManager.getDiscordConfig();
    const previousTargets = dedupe([
      ...(existing ? [existing.channelId] : []),
      ...(existing?.channelIds ?? []),
    ]);
    const retainedSecondary = dedupe(previousTargets.filter(id => id !== channelId));
    const ownerId = existing?.ownerId;

    try {
      await context.configManager.saveDiscordConfig(botToken, channelId, retainedSecondary, ownerId);
      display.successText('Discord configured!');
      display.muted('Bot token: ' + botToken.slice(0, 20) + '...');
      display.muted('Primary channel ID: ' + channelId);
      if (retainedSecondary.length > 0) {
        display.muted('Additional channel IDs: ' + retainedSecondary.join(', '));
      }
      if (ownerId) {
        display.muted('Owner user ID: ' + ownerId);
      }
      display.warningText('Restart slashbot to connect to Discord');
    } catch (error) {
      display.errorText('Error saving config: ' + (error instanceof Error ? error.message : String(error)));
    }

    return true;
  },
};

export const discordCommands: CommandHandler[] = [discordCommand];
