/**
 * Discord Plugin for Slashbot
 *
 * Manages the Discord connector integration
 */

import type { ConnectorPlugin, PluginMetadata, PluginContext } from '../../plugins/types';

export class DiscordPlugin implements ConnectorPlugin {
  readonly metadata: PluginMetadata = {
    id: 'connector.discord',
    name: 'Discord Connector',
    version: '1.0.0',
    category: 'connector',
    description: 'Provides Discord bot integration for messaging',
    contextInject: false,
  };

  private context!: PluginContext;
  private discordCmds: any[] | null = null;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    const { discordCommands } = await import('./commands');
    this.discordCmds = discordCommands;
  }

  async createConnector(_context: PluginContext): Promise<any | null> {
    const config = (this.context.configManager as any)?.getDiscordConfig?.();
    if (!config) return null;

    const { createDiscordConnector } = await import('./connector');
    return createDiscordConnector(config);
  }

  getCommandContributions() {
    return this.discordCmds || [];
  }

  getActionContributions(): any[] {
    return [];
  }

  getPromptContributions(): any[] {
    return [
      {
        id: 'connector.discord.installation',
        title: 'Discord Connector Installation',
        priority: 100,
        content: [
          'To install and configure the Discord connector:',
          '',
          '1. Create a Discord application at https://discord.com/developers/applications',
          '2. Go to the Bot section and create a bot.',
          '3. Copy the bot token.',
          '4. Invite the bot to your server with appropriate permissions.',
          '5. Get the channel ID by right-clicking the channel > Copy ID (enable Developer Mode in User Settings > App Settings > Advanced).',
          '6. In Slashbot, run /discord <bot_token> <channel_id>',
          '7. The bot will connect and respond to messages in that channel.',
        ],
      },
    ];
  }
}
