/**
 * Connector Plugin - Telegram
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
import { display, formatToolAction } from '../../core/ui';
import { getTelegramParserConfigs } from './parser';

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

export class TelegramPlugin implements ConnectorPlugin {
  readonly metadata: PluginMetadata = {
    id: 'connector.telegram',
    name: 'Telegram',
    version: '1.0.0',
    category: 'connector',
    description: 'Telegram bot connector',
    contextInject: false,
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
    ];
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
- Get bot token from @BotFather
- After config, restart slashbot to connect
- Multi-chat: use /telegram add <chat_id> and /telegram remove <chat_id> to manage authorized chats`,
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
