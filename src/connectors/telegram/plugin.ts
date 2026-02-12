/**
 * Connector Plugin - Telegram
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
import { getTelegramParserConfigs } from './parser';
import { TYPES } from '../../core/di/types';
import { createConnectorKernelHooks } from '../pluginHooks';

function dedupe(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
}

async function executeTelegramConfig(
  action: { type: 'telegram-config'; botToken: string; chatId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramConfig) return null;

  const detail = action.chatId ? `chat_id: ${action.chatId}` : 'auto-detect chat_id';

  try {
    const result = await handlers.onTelegramConfig(action.botToken, action.chatId);

    if (result.success) {
      display.appendAssistantMessage(formatToolAction('TelegramConfig', detail, { success: true, summary: `Chat ID: ${result.chatId || action.chatId}` }));
    } else {
      display.appendAssistantMessage(formatToolAction('TelegramConfig', detail, { success: false, summary: result.message }));
    }

    return {
      action: 'TelegramConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Telegram config failed: ${errorMsg}`);
    return {
      action: 'TelegramConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeTelegramStatus(
  _action: { type: 'telegram-status' },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramStatus) return null;
  const payload = await handlers.onTelegramStatus();
  const configured = !!payload?.configured;
  const running = !!payload?.running;
  const authorized = Array.isArray(payload?.authorizedTargets)
    ? payload.authorizedTargets
    : [];
  display.appendAssistantMessage(
    formatToolAction('TelegramStatus', 'runtime', {
      success: configured,
      summary: running ? 'running' : configured ? 'configured' : 'not configured',
    }),
  );
  return {
    action: 'TelegramStatus',
    success: configured,
    result: [
      `configured=${configured}`,
      `running=${running}`,
      `primary=${payload?.primaryChatId || '(none)'}`,
      `active=${payload?.activeChatId || '(none)'}`,
      `authorized=${authorized.length > 0 ? authorized.join(', ') : '(none)'}`,
    ].join('\n'),
    error: configured ? undefined : 'Telegram is not configured',
  };
}

async function executeTelegramAdd(
  action: { type: 'telegram-add'; chatId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramAddChat) return null;
  const result = await handlers.onTelegramAddChat(action.chatId);
  display.appendAssistantMessage(
    formatToolAction('TelegramAdd', action.chatId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'TelegramAdd',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeTelegramRemove(
  action: { type: 'telegram-remove'; chatId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramRemoveChat) return null;
  const result = await handlers.onTelegramRemoveChat(action.chatId);
  display.appendAssistantMessage(
    formatToolAction('TelegramRemove', action.chatId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'TelegramRemove',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeTelegramPrimary(
  action: { type: 'telegram-primary'; chatId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramPrimaryChat) return null;
  const result = await handlers.onTelegramPrimaryChat(action.chatId);
  display.appendAssistantMessage(
    formatToolAction('TelegramPrimary', action.chatId, {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'TelegramPrimary',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeTelegramClear(
  _action: { type: 'telegram-clear' },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramClear) return null;
  const result = await handlers.onTelegramClear();
  display.appendAssistantMessage(
    formatToolAction('TelegramClear', 'config', {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'TelegramClear',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

async function executeTelegramSend(
  action: { type: 'telegram-send'; message: string; chatId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramSend) return null;
  const result = await handlers.onTelegramSend(action.message, action.chatId);
  display.appendAssistantMessage(
    formatToolAction('TelegramSend', action.chatId || 'active', {
      success: !!result?.success,
      summary: result?.message || '',
    }),
  );
  return {
    action: 'TelegramSend',
    success: !!result?.success,
    result: result?.message || '',
    error: result?.success ? undefined : result?.message || 'Failed',
  };
}

export class TelegramPlugin implements ConnectorPlugin {
  readonly metadata: PluginMetadata = {
    id: 'connector.telegram',
    name: 'Telegram',
    version: '1.0.0',
    category: 'connector',
    description: 'Telegram bot connector',
    contextInject: true,
  };

  private context!: PluginContext;
  private telegramCmds: any[] | null = null;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getTelegramParserConfigs()) {
      registerActionParser(config);
    }
    const { telegramCommands } = await import('./commands');
    this.telegramCmds = telegramCommands;
  }

  async createConnector(_context: PluginContext): Promise<any | null> {
    const config = (this.context.configManager as any)?.getTelegramConfig?.();
    if (!config) return null;

    const { createTelegramConnector } = await import('./connector');
    return createTelegramConnector(config);
  }

  getCommandContributions() {
    return this.telegramCmds || [];
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
        type: 'telegram-config',
        tagName: 'telegram-config',
        handler: {
          onTelegramConfig: async (botToken: string, chatId?: string) => {
            try {
              let finalChatId = chatId;
              if (!finalChatId) {
                const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
                const data = (await response.json()) as any;
                if (!data.ok) return { success: false, message: 'Invalid bot token' };
                const update = data.result?.find((u: any) => u.message?.chat?.id);
                if (update?.message?.chat?.id) {
                  finalChatId = String(update.message.chat.id);
                } else {
                  return {
                    success: false,
                    message: 'No messages found. Send a message to the bot first.',
                  };
                }
              }
              await (context.configManager as any)?.saveTelegramConfig?.(botToken, finalChatId);
              return {
                success: true,
                message: 'Telegram configured! Restart to connect.',
                chatId: finalChatId,
              };
            } catch (error: any) {
              return { success: false, message: error.message || 'Configuration failed' };
            }
          },
        },
        execute: executeTelegramConfig as any,
      },
      {
        type: 'telegram-status',
        tagName: 'telegram-status',
        handler: {
          onTelegramStatus: async () => {
            const cfg = (context.configManager as any)?.getTelegramConfig?.();
            const registry = getRegistry();
            const runtime = registry?.get?.('telegram')?.getStatus?.();
            const configuredTargets = cfg ? dedupe([cfg.chatId, ...(cfg.chatIds || [])]) : [];
            const authorizedTargets =
              runtime?.authorizedTargets?.length > 0
                ? runtime.authorizedTargets
                : configuredTargets;
            return {
              configured: !!cfg,
              running: !!(runtime?.running || registry?.get?.('telegram')?.isRunning?.()),
              primaryChatId: runtime?.primaryTarget || cfg?.chatId || '',
              activeChatId: runtime?.activeTarget || cfg?.chatId || '',
              authorizedTargets,
            };
          },
        },
        execute: executeTelegramStatus as any,
      },
      {
        type: 'telegram-add',
        tagName: 'telegram-add',
        handler: {
          onTelegramAddChat: async (chatId: string) => {
            try {
              await (context.configManager as any)?.addTelegramChat?.(chatId);
              return {
                success: true,
                message: `Added Telegram chat ${chatId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to add chat' };
            }
          },
        },
        execute: executeTelegramAdd as any,
      },
      {
        type: 'telegram-remove',
        tagName: 'telegram-remove',
        handler: {
          onTelegramRemoveChat: async (chatId: string) => {
            try {
              await (context.configManager as any)?.removeTelegramChat?.(chatId);
              return {
                success: true,
                message: `Removed Telegram chat ${chatId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to remove chat' };
            }
          },
        },
        execute: executeTelegramRemove as any,
      },
      {
        type: 'telegram-primary',
        tagName: 'telegram-primary',
        handler: {
          onTelegramPrimaryChat: async (chatId: string) => {
            try {
              await (context.configManager as any)?.setTelegramPrimaryChat?.(chatId);
              return {
                success: true,
                message: `Primary Telegram chat set to ${chatId}. Restart slashbot to apply changes.`,
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to set primary chat' };
            }
          },
        },
        execute: executeTelegramPrimary as any,
      },
      {
        type: 'telegram-clear',
        tagName: 'telegram-clear',
        handler: {
          onTelegramClear: async () => {
            try {
              await (context.configManager as any)?.clearTelegramConfig?.();
              const registry = getRegistry();
              const connector = registry?.get?.('telegram');
              connector?.stop?.();
              registry?.getAll?.().delete('telegram');
              return { success: true, message: 'Telegram configuration cleared' };
            } catch (error: any) {
              return {
                success: false,
                message: error?.message || 'Failed to clear Telegram configuration',
              };
            }
          },
        },
        execute: executeTelegramClear as any,
      },
      {
        type: 'telegram-send',
        tagName: 'telegram-send',
        handler: {
          onTelegramSend: async (message: string, chatId?: string) => {
            try {
              const registry = getRegistry();
              if (!registry) {
                return { success: false, message: 'Connector registry unavailable' };
              }
              const outcome = await registry.notify(message, 'telegram', chatId);
              if (outcome.sent.includes('telegram')) {
                return {
                  success: true,
                  message: `Message sent to Telegram${chatId ? ` chat ${chatId}` : ''}`,
                };
              }
              const runtime = registry.get?.('telegram')?.getStatus?.();
              if (!runtime?.configured) {
                return { success: false, message: 'Telegram is not configured' };
              }
              if (!runtime?.running) {
                return { success: false, message: 'Telegram connector is not running' };
              }
              return {
                success: false,
                message: 'Telegram notification failed or target is not authorized',
              };
            } catch (error: any) {
              return { success: false, message: error?.message || 'Failed to send Telegram message' };
            }
          },
        },
        execute: executeTelegramSend as any,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return [
      {
        name: 'telegram_status',
        description: 'Show Telegram connector configuration and runtime status.',
        parameters: z.object({}),
        toAction: () => ({ type: 'telegram-status' }),
      },
      {
        name: 'telegram_add_chat',
        description: 'Add an authorized Telegram chat id.',
        parameters: z.object({
          chat_id: z.string().describe('Telegram chat id to authorize'),
        }),
        toAction: args => ({
          type: 'telegram-add',
          chatId: args.chat_id as string,
        }),
      },
      {
        name: 'telegram_remove_chat',
        description: 'Remove an authorized Telegram chat id.',
        parameters: z.object({
          chat_id: z.string().describe('Telegram chat id to remove'),
        }),
        toAction: args => ({
          type: 'telegram-remove',
          chatId: args.chat_id as string,
        }),
      },
      {
        name: 'telegram_primary_chat',
        description: 'Set primary Telegram chat id.',
        parameters: z.object({
          chat_id: z.string().describe('Telegram chat id to set as primary'),
        }),
        toAction: args => ({
          type: 'telegram-primary',
          chatId: args.chat_id as string,
        }),
      },
      {
        name: 'telegram_clear',
        description: 'Clear Telegram connector configuration.',
        parameters: z.object({}),
        toAction: () => ({ type: 'telegram-clear' }),
      },
      {
        name: 'telegram_send',
        description: 'Send a message through Telegram connector to active or specific authorized chat.',
        parameters: z.object({
          message: z.string().describe('Message to send'),
          chat_id: z
            .string()
            .optional()
            .describe('Optional target chat id, defaults to active reply target'),
        }),
        toAction: args => ({
          type: 'telegram-send',
          message: args.message as string,
          chatId: args.chat_id as string | undefined,
        }),
      },
    ];
  }

  getKernelHooks(): KernelHookContribution[] {
    return createConnectorKernelHooks({
      connectorId: 'telegram',
      sidebarLabel: 'Telegram',
      sidebarOrder: 10,
      protectedAgentId: 'agent-telegramagent',
    });
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'connector.telegram.docs',
        title: 'Platform [TELEGRAM]',
        priority: 200,
        content: `- Execute actions, end with 1-2 sentence summary.

Telegram Configuration
\`\`\`
<telegram-config bot_token="123:ABC..." chat_id="987654321"/>
<telegram-config bot_token="123:ABC..."/>  <!-- auto-detect chat_id -->
\`\`\`
- Telegram Runtime Tags
\`\`\`
<telegram-status/>
<telegram-add chat_id="123456789"/>
<telegram-remove chat_id="123456789"/>
<telegram-primary chat_id="123456789"/>
<telegram-send chat_id="123456789">hello from slashbot</telegram-send>
<telegram-clear/>
\`\`\`
- Telegram Runtime Tools: \`telegram_status\`, \`telegram_add_chat\`, \`telegram_remove_chat\`, \`telegram_primary_chat\`, \`telegram_send\`, \`telegram_clear\`
- Get bot token from @BotFather
- After config, restart slashbot to connect
- Multi-chat: use /telegram add|remove|primary <chat_id> to manage authorized chats`,
        enabled: () => {
          try {
            return !!(this.context.configManager as any)?.getTelegramConfig?.();
          } catch {
            return false;
          }
        },
      },
    ];
  }
}
