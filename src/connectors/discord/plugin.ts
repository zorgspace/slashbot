/**
 * Connector Plugin - Discord
 */

import type {
  ConnectorPlugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../../plugins/types';
import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import { registerActionParser } from '../../core/actions/parser';
import { display } from '../../core/ui';
import { getDiscordParserConfigs } from './parser';

async function executeDiscordConfig(
  action: { type: 'discord-config'; botToken: string; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordConfig) return null;

  display.tool('DiscordConfig', `channel_id: ${action.channelId}`);

  try {
    const result = await handlers.onDiscordConfig(action.botToken, action.channelId);

    if (result.success) {
      display.result(`Discord configured! Channel ID: ${action.channelId}`);
    } else {
      display.error(result.message);
    }

    return {
      action: 'DiscordConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Discord config failed: ${errorMsg}`);
    return {
      action: 'DiscordConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeDiscordThread(
  action: { type: 'discord-thread'; name: string; message?: string; channelId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordThread) return null;

  display.tool('DiscordThread', `name: "${action.name}"`);

  try {
    const result = await handlers.onDiscordThread(action.name, action.message, action.channelId);

    if (result.success) {
      display.result(`Thread created: ${result.threadId}`);
    } else {
      display.error(result.message);
    }

    return {
      action: 'DiscordThread',
      success: result.success,
      result: result.success ? `Thread created: ${result.threadId}` : result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Discord thread creation failed: ${errorMsg}`);
    return {
      action: 'DiscordThread',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeDiscordAddChannel(
  action: { type: 'discord-add-channel'; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordAddChannel) return null;

  display.tool('DiscordAddChannel', `channel_id: ${action.channelId}`);

  try {
    const result = await handlers.onDiscordAddChannel(action.channelId);

    if (result.success) {
      display.result(`Channel added: ${action.channelId}`);
    } else {
      display.error(result.message);
    }

    return {
      action: 'DiscordAddChannel',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Discord add channel failed: ${errorMsg}`);
    return {
      action: 'DiscordAddChannel',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

export class DiscordPlugin implements ConnectorPlugin {
  readonly metadata: PluginMetadata = {
    id: 'connector.discord',
    name: 'Discord',
    version: '1.0.0',
    category: 'connector',
    description: 'Discord bot connector',
  };

  private context!: PluginContext;
  private discordCmds: any[] | null = null;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getDiscordParserConfigs()) {
      registerActionParser(config);
    }
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

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    return [
      {
        type: 'discord-config',
        tagName: 'discord-config',
        handler: {
          onDiscordConfig: async (botToken: string, channelId: string) => {
            try {
              await (context.configManager as any)?.saveDiscordConfig?.(botToken, channelId);
              return { success: true, message: 'Discord configured! Restart to connect.' };
            } catch (error: any) {
              return { success: false, message: error.message || 'Configuration failed' };
            }
          },
        },
        execute: executeDiscordConfig as any,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'connector.discord.docs',
        title: 'Platform [DISCORD]',
        priority: 210,
        content: `- Execute actions, end with 1-2 sentence summary in plain language
- NEVER include code snippets or technical details in the final summary

## Discord Configuration
\`\`\`
<discord-config bot_token="MTk..." channel_id="123456789"/>
\`\`\`
- Get token from Developer Portal, channel ID from right-click > Copy ID
- After config, restart slashbot to connect

## Multi-Channel Support
Each channel has its own isolated conversation history.

## Discord Thread Management
\`\`\`
<discord-thread name="Project Discussion">Initial message here</discord-thread>
<discord-add-channel channel_id="987654321"/>
\`\`\``,
        enabled: () => {
          try {
            return !!(this.context.configManager as any)?.getDiscordConfig?.();
          } catch {
            return false;
          }
        },
      },
    ];
  }
}
