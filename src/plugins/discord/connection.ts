import type { StructuredLogger } from '../../plugin-sdk/index.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { ConnectorStatus, DiscordState } from './types.js';
import { acquireLock, releaseLock } from './lock.js';

export function setStatus(
  state: DiscordState,
  nextStatus: ConnectorStatus,
  kernel?: SlashbotKernel | null,
): void {
  state.status = nextStatus;
  state.updateIndicatorStatus?.(nextStatus);
  kernel?.events.publish('connector:discord:status', { status: nextStatus });
}

export async function stopClientSafely(state: DiscordState): Promise<void> {
  if (!state.client) return;
  try {
    await state.client.destroy();
  } catch {
    // discord.js can throw if startup failed before ready.
  } finally {
    state.client = null;
  }
}

export async function connectClient(
  state: DiscordState,
  token: string,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  setupHandlers: (client: import('discord.js').Client) => void,
): Promise<void> {
  if (state.client) {
    await stopClientSafely(state);
    await releaseLock(state);
  }

  const locked = await acquireLock(state);
  if (!locked) {
    setStatus(state, 'disconnected', kernel);
    logger.info('Discord lock held by another instance');
    return;
  }

  try {
    const { Client, GatewayIntentBits, Partials } = await import('discord.js');
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
    state.client = client;

    setupHandlers(client);

    await client.login(token);
    setStatus(state, 'connected', kernel);
    logger.info('Discord bot connected', {
      username: client.user?.username ?? 'unknown',
    });
  } catch (err) {
    setStatus(state, 'disconnected', kernel);
    logger.error('Discord bot launch failed', { error: String(err) });
    state.client = null;
    await releaseLock(state);
  }
}

export async function connectIfTokenPresent(
  state: DiscordState,
  kernel: SlashbotKernel,
  logger: StructuredLogger,
  setupHandlers: (client: import('discord.js').Client) => void,
): Promise<boolean> {
  if (state.status === 'connected') return true;
  const token = state.config.botToken ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;
  await connectClient(state, token, kernel, logger, setupHandlers);
  return (state.status as ConnectorStatus) === 'connected';
}
