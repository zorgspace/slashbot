/**
 * Connector Plugin - Discord
 */

import type {
  ConnectorPlugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
  KernelHookContribution,
} from '../../plugins/types';
import { z } from 'zod/v4';
import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import { registerActionParser } from '../../core/actions/parser';
import { display, formatToolAction } from '../../core/ui';
import { getDiscordParserConfigs } from './parser';
import { TYPES } from '../../core/di/types';
import { createConnectorKernelHooks } from '../pluginHooks';

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

async function executeDiscordConfig(
  action: {
    type: 'discord-config';
    botToken: string;
    channelId: string;
    channelIds?: string[];
    ownerId?: string;
  },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordConfig) return null;

  const detail = `channel_id: ${action.channelId}`;

  try {
    const result = await handlers.onDiscordConfig(
      action.botToken,
      action.channelId,
      action.channelIds,
      action.ownerId,
    );

    if (result.success) {
      display.appendAssistantMessage(
        formatToolAction('DiscordConfig', detail, {
          success: true,
          summary: `Primary: ${result.channelId || action.channelId}`,
        }),
      );
    } else {
      display.appendAssistantMessage(
        formatToolAction('DiscordConfig', detail, {
          success: false,
          summary: result.message,
        }),
      );
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

async function executeDiscordStatus(
  _action: { type: 'discord-status' },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordStatus) return null;
  const payload = await handlers.onDiscordStatus();
  const configured = !!payload?.configured;
  const running = !!payload?.running;
  const authorized = Array.isArray(payload?.authorizedTargets) ? payload.authorizedTargets : [];
  display.appendAssistantMessage(
    formatToolAction('DiscordStatus', 'runtime', {
      success: configured,
      summary: running ? 'running' : configured ? 'configured' : 'not configured',
    }),
  );
  return {
    action: 'DiscordStatus',
    success: configured,
    result: [
      `configured=${configured}`,
      `running=${running}`,
      `primary=${payload?.primaryChannelId || '(none)'}`,
      `active=${payload?.activeChannelId || '(none)'}`,
      `owner=${payload?.ownerId || '(none)'}`,
      `authorized=${authorized.length > 0 ? authorized.join(', ') : '(none)'}`,
    ].join('\n'),
    error: configured ? undefined : 'Discord is not configured',
  };
}

async function executeDiscordAdd(
  action: { type: 'discord-add'; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordAddChannel) return null;
  const result = await handlers.onDiscordAddChannel(action.channelId);
  display.appendAssistantMessage(
    formatToolAction('DiscordAdd', action.channelId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordAdd',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordRemove(
  action: { type: 'discord-remove'; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordRemoveChannel) return null;
  const result = await handlers.onDiscordRemoveChannel(action.channelId);
  display.appendAssistantMessage(
    formatToolAction('DiscordRemove', action.channelId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordRemove',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordPrimary(
  action: { type: 'discord-primary'; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordPrimaryChannel) return null;
  const result = await handlers.onDiscordPrimaryChannel(action.channelId);
  display.appendAssistantMessage(
    formatToolAction('DiscordPrimary', action.channelId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordPrimary',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordOwner(
  action: { type: 'discord-owner'; ownerId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordOwner) return null;
  const result = await handlers.onDiscordOwner(action.ownerId);
  display.appendAssistantMessage(
    formatToolAction('DiscordOwner', action.ownerId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordOwner',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordOwnerClear(
  _action: { type: 'discord-owner-clear' },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordOwnerClear) return null;
  const result = await handlers.onDiscordOwnerClear();
  display.appendAssistantMessage(
    formatToolAction('DiscordOwnerClear', 'owner', {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordOwnerClear',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordClear(
  _action: { type: 'discord-clear' },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordClear) return null;
  const result = await handlers.onDiscordClear();
  display.appendAssistantMessage(
    formatToolAction('DiscordClear', 'config', {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordClear',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeDiscordSend(
  action: { type: 'discord-send'; message: string; channelId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordSend) return null;
  const result = await handlers.onDiscordSend(action.message, action.channelId);
  display.appendAssistantMessage(
    formatToolAction('DiscordSend', action.channelId || 'active', {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'DiscordSend',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

export class DiscordPlugin implements ConnectorPlugin {
  readonly metadata: PluginMetadata = {
    id: 'connector.discord',
    name: 'Discord Connector',
    version: '1.0.0',
    category: 'connector',
    description: 'Provides Discord bot integration for messaging',
    contextInject: true,
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
    const getRegistry = (): any | null => {
      try {
        return context.container.get<any>(TYPES.ConnectorRegistry);
      } catch {
        return null;
      }
    };

    return [
      {
        type: 'discord-config',
        tagName: 'discord-config',
        handler: {
          onDiscordConfig: async (
            botToken: string,
            channelId: string,
            channelIds?: string[],
            ownerId?: string,
          ) => {
            try {
              await (context.configManager as any)?.saveDiscordConfig?.(
                botToken,
                channelId,
                channelIds,
                ownerId,
              );
              return {
                success: true,
                message: 'Discord configured! Restart to connect.',
                channelId,
              };
            } catch (error: any) {
              return { success: false, message: error.message || 'Configuration failed' };
            }
          },
        },
        execute: executeDiscordConfig as any,
      },
      {
        type: 'discord-status',
        tagName: 'discord-status',
        handler: {
          onDiscordStatus: async () => {
            const cfg = (context.configManager as any)?.getDiscordConfig?.();
            const registry = getRegistry();
            const runtime = registry?.get?.('discord')?.getStatus?.();
            const configuredTargets = cfg ? dedupe([cfg.channelId, ...(cfg.channelIds || [])]) : [];
            const authorizedTargets =
              runtime?.authorizedTargets?.length > 0
                ? runtime.authorizedTargets
                : configuredTargets;
            return {
              configured: !!cfg,
              running: !!(runtime?.running || registry?.get?.('discord')?.isRunning?.()),
              primaryChannelId: runtime?.primaryTarget || cfg?.channelId || '',
              activeChannelId: runtime?.activeTarget || cfg?.channelId || '',
              ownerId: runtime?.ownerId || cfg?.ownerId || '',
              authorizedTargets,
            };
          },
        },
        execute: executeDiscordStatus as any,
      },
      {
        type: 'discord-add',
        tagName: 'discord-add',
        handler: {
          onDiscordAddChannel: async (channelId: string) => {
            try {
              await (context.configManager as any)?.addDiscordChannel?.(channelId);
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.() && typeof connector.addChannel === 'function') {
                connector.addChannel(channelId);
                return {
                  success: true,
                  message: `Added Discord channel ${channelId}.`,
                };
              }
              return {
                success: true,
                message: `Added Discord channel ${channelId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to add channel' };
            }
          },
        },
        execute: executeDiscordAdd as any,
      },
      {
        type: 'discord-remove',
        tagName: 'discord-remove',
        handler: {
          onDiscordRemoveChannel: async (channelId: string) => {
            try {
              await (context.configManager as any)?.removeDiscordChannel?.(channelId);
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.() && typeof connector.removeChannel === 'function') {
                connector.removeChannel(channelId);
                return {
                  success: true,
                  message: `Removed Discord channel ${channelId}.`,
                };
              }
              return {
                success: true,
                message: `Removed Discord channel ${channelId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to remove channel' };
            }
          },
        },
        execute: executeDiscordRemove as any,
      },
      {
        type: 'discord-primary',
        tagName: 'discord-primary',
        handler: {
          onDiscordPrimaryChannel: async (channelId: string) => {
            try {
              await (context.configManager as any)?.setDiscordPrimaryChannel?.(channelId);
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.()) {
                if (typeof connector.setPrimaryChannel === 'function') {
                  connector.setPrimaryChannel(channelId);
                } else if (typeof connector.addChannel === 'function') {
                  connector.addChannel(channelId);
                }
                return {
                  success: true,
                  message: `Primary Discord channel set to ${channelId}.`,
                };
              }
              return {
                success: true,
                message: `Primary Discord channel set to ${channelId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return {
                success: false,
                message: error?.message || 'Failed to set primary channel',
              };
            }
          },
        },
        execute: executeDiscordPrimary as any,
      },
      {
        type: 'discord-owner',
        tagName: 'discord-owner',
        handler: {
          onDiscordOwner: async (ownerId: string) => {
            try {
              await (context.configManager as any)?.setDiscordOwnerId?.(ownerId);
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.() && typeof connector.setOwnerId === 'function') {
                connector.setOwnerId(ownerId);
                return {
                  success: true,
                  message: `Discord owner user id set to ${ownerId}.`,
                };
              }
              return {
                success: true,
                message: `Discord owner user id set to ${ownerId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to set owner id' };
            }
          },
          onDiscordOwnerClear: async () => {
            try {
              const cfg = (context.configManager as any)?.getDiscordConfig?.();
              if (!cfg) {
                return { success: false, message: 'Discord is not configured' };
              }
              await (context.configManager as any)?.saveDiscordConfig?.(
                cfg.botToken,
                cfg.channelId,
                cfg.channelIds,
                undefined,
              );
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.() && typeof connector.setOwnerId === 'function') {
                connector.setOwnerId(null);
                return {
                  success: true,
                  message: 'Discord owner user id cleared.',
                };
              }
              return {
                success: true,
                message: 'Discord owner user id cleared. Restart slashbot to apply changes.',
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to clear owner id' };
            }
          },
        },
        execute: executeDiscordOwner as any,
      },
      {
        type: 'discord-owner-clear',
        tagName: 'discord-owner-clear',
        handler: {
          onDiscordOwnerClear: async () => {
            try {
              const cfg = (context.configManager as any)?.getDiscordConfig?.();
              if (!cfg) {
                return { success: false, message: 'Discord is not configured' };
              }
              await (context.configManager as any)?.saveDiscordConfig?.(
                cfg.botToken,
                cfg.channelId,
                cfg.channelIds,
                undefined,
              );
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              if (connector?.isRunning?.() && typeof connector.setOwnerId === 'function') {
                connector.setOwnerId(null);
                return {
                  success: true,
                  message: 'Discord owner user id cleared.',
                };
              }
              return {
                success: true,
                message: 'Discord owner user id cleared. Restart slashbot to apply changes.',
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to clear owner id' };
            }
          },
        },
        execute: executeDiscordOwnerClear as any,
      },
      {
        type: 'discord-clear',
        tagName: 'discord-clear',
        handler: {
          onDiscordClear: async () => {
            try {
              await (context.configManager as any)?.clearDiscordConfig?.();
              const registry = getRegistry();
              const connector = registry?.get?.('discord');
              connector?.stop?.();
              registry?.getAll?.().delete('discord');
              return { success: true, message: 'Discord configuration cleared' };
            } catch (error: any) {
              return {
                success: false,
                message: error?.message || 'Failed to clear Discord configuration',
              };
            }
          },
        },
        execute: executeDiscordClear as any,
      },
      {
        type: 'discord-send',
        tagName: 'discord-send',
        handler: {
          onDiscordSend: async (message: string, channelId?: string) => {
            try {
              const registry = getRegistry();
              if (!registry) {
                return { success: false, message: 'Connector registry unavailable' };
              }
              const outcome = await registry.notify(message, 'discord', channelId);
              if (outcome.sent.includes('discord')) {
                return {
                  success: true,
                  message: `Message sent to Discord${channelId ? ` channel ${channelId}` : ''}`,
                };
              }
              const runtime = registry.get?.('discord')?.getStatus?.();
              if (!runtime?.configured) {
                return { success: false, message: 'Discord is not configured' };
              }
              if (!runtime?.running) {
                return { success: false, message: 'Discord connector is not running' };
              }
              return {
                success: false,
                message: 'Discord notification failed or target is not authorized',
              };
            } catch (error: any) {
              return {
                success: false,
                message: error?.message || 'Failed to send Discord message',
              };
            }
          },
        },
        execute: executeDiscordSend as any,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return [
      {
        name: 'discord_status',
        description: 'Show Discord connector configuration and runtime status.',
        parameters: z.object({}),
        toAction: () => ({ type: 'discord-status' }),
      },
      {
        name: 'discord_add_channel',
        description: 'Add an authorized Discord channel id.',
        parameters: z.object({
          channel_id: z.string().describe('Discord channel id to authorize'),
        }),
        toAction: args => ({
          type: 'discord-add',
          channelId: args.channel_id as string,
        }),
      },
      {
        name: 'discord_remove_channel',
        description: 'Remove an authorized Discord channel id.',
        parameters: z.object({
          channel_id: z.string().describe('Discord channel id to remove'),
        }),
        toAction: args => ({
          type: 'discord-remove',
          channelId: args.channel_id as string,
        }),
      },
      {
        name: 'discord_primary_channel',
        description: 'Set primary Discord channel id.',
        parameters: z.object({
          channel_id: z.string().describe('Discord channel id to set as primary'),
        }),
        toAction: args => ({
          type: 'discord-primary',
          channelId: args.channel_id as string,
        }),
      },
      {
        name: 'discord_owner_set',
        description: 'Set Discord owner user id (used for private thread authorization).',
        parameters: z.object({
          owner_id: z.string().describe('Discord user id to set as owner'),
        }),
        toAction: args => ({
          type: 'discord-owner',
          ownerId: args.owner_id as string,
        }),
      },
      {
        name: 'discord_owner_clear',
        description: 'Clear Discord owner user id.',
        parameters: z.object({}),
        toAction: () => ({ type: 'discord-owner-clear' }),
      },
      {
        name: 'discord_clear',
        description: 'Clear Discord connector configuration.',
        parameters: z.object({}),
        toAction: () => ({ type: 'discord-clear' }),
      },
      {
        name: 'discord_send',
        description:
          'Send a message through Discord connector to active or specific authorized channel.',
        parameters: z.object({
          message: z.string().describe('Message to send'),
          channel_id: z
            .string()
            .optional()
            .describe('Optional target channel id, defaults to active channel'),
        }),
        toAction: args => ({
          type: 'discord-send',
          message: args.message as string,
          channelId: args.channel_id as string | undefined,
        }),
      },
    ];
  }

  getKernelHooks(): KernelHookContribution[] {
    return createConnectorKernelHooks({
      connectorId: 'discord',
      sidebarLabel: 'Discord',
      sidebarOrder: 11,
    });
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'connector.discord.docs',
        title: 'Platform [DISCORD]',
        priority: 200,
        content: `- Execute actions and end with a concise status summary.

Discord Configuration
\`\`\`
<discord-config bot_token="DISCORD_TOKEN" channel_id="123456789012345678"/>
<discord-config bot_token="DISCORD_TOKEN" channel_id="123456789012345678" channel_ids="111,222,333"/>
<discord-config bot_token="DISCORD_TOKEN" channel_id="123456789012345678" owner_id="987654321098765432"/>
\`\`\`
- Discord Runtime Tags
\`\`\`
<discord-status/>
<discord-add channel_id="123456789012345678"/>
<discord-remove channel_id="123456789012345678"/>
<discord-primary channel_id="123456789012345678"/>
<discord-owner owner_id="987654321098765432"/>
<discord-owner-clear/>
<discord-send channel_id="123456789012345678">hello from slashbot</discord-send>
<discord-clear/>
\`\`\`
- Discord Runtime Tools: \`discord_status\`, \`discord_add_channel\`, \`discord_remove_channel\`, \`discord_primary_channel\`, \`discord_owner_set\`, \`discord_owner_clear\`, \`discord_send\`, \`discord_clear\`
- After configuration, restart slashbot to connect.
- Multi-channel authorization is managed by /discord add|remove|primary.`,
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
