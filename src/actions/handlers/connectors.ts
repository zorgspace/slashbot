/**
 * Connector Configuration Action Handlers - Telegram and Discord setup
 */

import type { ActionResult, ActionHandlers } from '../types';
import { step } from '../../ui/colors';

export async function executeTelegramConfig(
  action: { type: 'telegram-config'; botToken: string; chatId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramConfig) return null;

  step.tool('TelegramConfig', action.chatId ? `chat_id: ${action.chatId}` : 'auto-detect chat_id');

  try {
    const result = await handlers.onTelegramConfig(action.botToken, action.chatId);

    if (result.success) {
      step.result(`Telegram configured! Chat ID: ${result.chatId || action.chatId}`);
    } else {
      step.error(result.message);
    }

    return {
      action: 'TelegramConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Telegram config failed: ${errorMsg}`);
    return {
      action: 'TelegramConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

export async function executeDiscordConfig(
  action: { type: 'discord-config'; botToken: string; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordConfig) return null;

  step.tool('DiscordConfig', `channel_id: ${action.channelId}`);

  try {
    const result = await handlers.onDiscordConfig(action.botToken, action.channelId);

    if (result.success) {
      step.result(`Discord configured! Channel ID: ${action.channelId}`);
    } else {
      step.error(result.message);
    }

    return {
      action: 'DiscordConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Discord config failed: ${errorMsg}`);
    return {
      action: 'DiscordConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
