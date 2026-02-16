import { promises as fsPromises } from 'node:fs';
import type { DiscordState } from './types.js';
import { DiscordConfigSchema } from './types.js';

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

export function isAuthorized(state: DiscordState, channelId: string): boolean {
  return state.config.authorizedChannelIds.includes(channelId);
}

export async function authorizeChannel(state: DiscordState, channelId: string): Promise<void> {
  if (!state.config.authorizedChannelIds.includes(channelId)) {
    state.config.authorizedChannelIds.push(channelId);
  }
  if (!state.config.primaryChannelId) {
    state.config.primaryChannelId = channelId;
  }
  await saveConfig(state);
}

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

export function listAuthorizedChannelIds(state: DiscordState): string[] {
  return [...new Set(state.config.authorizedChannelIds)];
}
