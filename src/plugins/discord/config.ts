/**
 * @module plugins/discord/config
 *
 * Persistent configuration management for the Discord connector plugin.
 * Handles loading, saving, and querying the Discord config file (discord.json),
 * including authorized channel IDs, primary channel, owner, and bot token.
 * Uses atomic write-then-rename for safe persistence.
 *
 * @see {@link loadConfig} - Read config from disk into state
 * @see {@link saveConfig} - Persist current state config to disk
 * @see {@link isAuthorized} - Check if a channel is authorized
 * @see {@link authorizeChannel} - Add a channel to the authorized list
 * @see {@link unauthorizeChannel} - Remove a channel from the authorized list
 * @see {@link listAuthorizedChannelIds} - List all authorized channel IDs
 */
import { promises as fsPromises } from 'node:fs';
import type { DiscordState } from './types.js';
import { DiscordConfigSchema } from './types.js';

/**
 * Load the Discord config from disk and merge it into the plugin state.
 * Falls back to default values if the file is missing or malformed.
 * @param state - Mutable Discord plugin state
 */
export async function loadConfig(state: DiscordState): Promise<void> {
  try {
    const data = await fsPromises.readFile(state.paths.configPath, 'utf8');
    const result = DiscordConfigSchema.safeParse(JSON.parse(data));
    if (result.success) {
      state.config = {
        ...state.config,
        ...result.data,
        authorizedChannelIds: [...new Set(result.data.authorizedChannelIds)],
      };
    }
  } catch { /* use defaults */ }
}

/**
 * Persist the current Discord config to disk using atomic write-then-rename.
 * Creates the config directory if it does not exist.
 * @param state - Discord plugin state containing paths and config
 */
export async function saveConfig(state: DiscordState): Promise<void> {
  await fsPromises.mkdir(state.paths.configDir, { recursive: true });
  const persisted = {
    botToken: state.config.botToken,
    authorizedChannelIds: [...new Set(state.config.authorizedChannelIds)],
    primaryChannelId: state.config.primaryChannelId,
    ownerId: state.config.ownerId,
  };
  await fsPromises.writeFile(state.paths.configTmpPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  await fsPromises.rename(state.paths.configTmpPath, state.paths.configPath);
}

/**
 * Check whether a Discord channel is in the authorized list.
 * @param state - Discord plugin state
 * @param channelId - The Discord channel ID to check
 * @returns `true` if the channel is authorized
 */
export function isAuthorized(state: DiscordState, channelId: string): boolean {
  return state.config.authorizedChannelIds.includes(channelId);
}

/**
 * Authorize a Discord channel for bot interaction.
 * If no primary channel is set, the newly authorized channel becomes primary.
 * Persists the updated config to disk.
 * @param state - Mutable Discord plugin state
 * @param channelId - The Discord channel ID to authorize
 */
export async function authorizeChannel(state: DiscordState, channelId: string): Promise<void> {
  if (!state.config.authorizedChannelIds.includes(channelId)) {
    state.config.authorizedChannelIds.push(channelId);
  }
  if (!state.config.primaryChannelId) {
    state.config.primaryChannelId = channelId;
  }
  await saveConfig(state);
}

/**
 * Remove authorization for a Discord channel.
 * If the removed channel was the primary, the primary shifts to the first
 * remaining authorized channel. Also cleans up any DM session mappings.
 * @param state - Mutable Discord plugin state
 * @param channelId - The Discord channel ID to unauthorize
 */
export async function unauthorizeChannel(state: DiscordState, channelId: string): Promise<void> {
  state.config.authorizedChannelIds = state.config.authorizedChannelIds.filter((id) => id !== channelId);
  if (state.config.primaryChannelId === channelId) {
    state.config.primaryChannelId = state.config.authorizedChannelIds[0];
  }
  for (const [sessionId, mappedChannelId] of state.dmChannelBySessionId.entries()) {
    if (mappedChannelId === channelId) {
      state.dmChannelBySessionId.delete(sessionId);
    }
  }
  await saveConfig(state);
}

/**
 * Return a deduplicated list of all authorized Discord channel IDs.
 * @param state - Discord plugin state
 * @returns Array of unique authorized channel ID strings
 */
export function listAuthorizedChannelIds(state: DiscordState): string[] {
  return [...new Set(state.config.authorizedChannelIds)];
}
