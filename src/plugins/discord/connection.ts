/**
 * @module plugins/discord/connection
 *
 * Discord client lifecycle management. Handles creating, connecting,
 * disconnecting, and reconnecting the discord.js Client instance.
 * Coordinates with the file-based lock to ensure only one process
 * runs the Discord bot at a time.
 *
 * @see {@link connectClient} - Create and login a Discord client
 * @see {@link stopClientSafely} - Gracefully destroy an existing client
 * @see {@link connectIfTokenPresent} - Connect only when a token is available
 * @see {@link setStatus} - Update connector status across the system
 */
import type { StructuredLogger } from '../../plugin-sdk/index.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { ConnectorStatus, DiscordState } from './types.js';
import { acquireLock, releaseLock } from './lock.js';

/**
 * Update the Discord connector status in state, TUI indicator, and event bus.
 * @param state - Mutable Discord plugin state
 * @param nextStatus - The new connector status to set
 * @param kernel - Optional kernel instance for publishing status events
 */
export function setStatus(
  state: DiscordState,
  nextStatus: ConnectorStatus,
  kernel?: SlashbotKernel | null,
): void {
  state.status = nextStatus;
  state.updateIndicatorStatus?.(nextStatus);
  kernel?.events.publish('connector:discord:status', { status: nextStatus });
}

/**
 * Gracefully destroy the active Discord client, if any.
 * Swallows errors from discord.js that may occur if the client never reached ready state.
 * @param state - Mutable Discord plugin state
 */
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

/**
 * Create a new discord.js Client, register message handlers, and login.
 * Acquires a file-based lock before connecting. If another instance holds
 * the lock, the status is set to 'disconnected' and the function returns.
 * @param state - Mutable Discord plugin state
 * @param token - Discord bot token
 * @param kernel - Kernel instance for status events
 * @param logger - Structured logger for diagnostics
 * @param setupHandlers - Callback to register event handlers on the new client
 */
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

/**
 * Connect the Discord bot only if a token is available (config or env).
 * No-op if already connected.
 * @param state - Mutable Discord plugin state
 * @param kernel - Kernel instance for status events
 * @param logger - Structured logger for diagnostics
 * @param setupHandlers - Callback to register event handlers on the new client
 * @returns `true` if the bot is connected after this call
 */
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
