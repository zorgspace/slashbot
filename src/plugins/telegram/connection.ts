import type { StructuredLogger } from '../../core/kernel/contracts.js';
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { ConnectorStatus, TelegramState } from './types.js';
import { acquireLock, releaseLock } from './lock.js';

export function setStatus(
  state: TelegramState,
  nextStatus: ConnectorStatus,
  kernel?: SlashbotKernel | null,
): void {
  state.status = nextStatus;
  state.updateIndicatorStatus?.(nextStatus);
  kernel?.events.publish('connector:telegram:status', { status: nextStatus });
}

export async function stopBotSafely(state: TelegramState, reason: string): Promise<void> {
  if (!state.bot) return;
  try {
    state.bot.stop(reason);
  } catch {
    // Telegraf can throw if startup failed before launch completed.
  } finally {
    state.bot = null;
  }
}

export async function connectBot(
  state: TelegramState,
  token: string,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  setupHandlers: (bot: import('telegraf').Telegraf) => void,
): Promise<void> {
  // Stop existing bot if any
  if (state.bot) {
    await stopBotSafely(state, 'reconnect');
    await releaseLock(state);
  }

  const locked = await acquireLock(state);
  if (!locked) {
    setStatus(state, 'disconnected', kernel);
    logger.info('Telegram lock held by another instance');
    return;
  }

  try {
    const { Telegraf } = await import('telegraf');
    const nextBot = new Telegraf(token);
    state.bot = nextBot;

    setupHandlers(nextBot);

    // Validate token and cache botInfo before starting the long-poll.
    await nextBot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    nextBot.botInfo = await nextBot.telegram.getMe();

    // launch() never resolves while polling is active — fire-and-forget.
    // botInfo is already cached so launch() skips getMe and goes straight to polling.
    const launchPromise = nextBot.launch({ dropPendingUpdates: true });
    launchPromise.catch((err) => {
      const message = String(err);
      logger.error('Telegram bot polling stopped', { error: message });
      state.bot = null;
      setStatus(state, 'disconnected', kernel);
      void releaseLock(state);
    });

    setStatus(state, 'connected', kernel);
  } catch (err) {
    const message = String(err);

    setStatus(state, 'disconnected', kernel);
    logger.error('Telegram bot launch failed', { error: message });
    state.bot = null;
    await releaseLock(state);
  }
}

export async function connectIfTokenPresent(
  state: TelegramState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  setupHandlers: (bot: import('telegraf').Telegraf) => void,
): Promise<boolean> {
  if (state.status === 'connected') return true;
  const token = state.config.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  await connectBot(state, token, kernel, logger, setupHandlers);
  return (state.status as ConnectorStatus) === 'connected';
}
