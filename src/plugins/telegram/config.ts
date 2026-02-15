import { promises as fsPromises } from 'node:fs';
import type { TelegramState } from './types.js';
import { TelegramConfigSchema } from './types.js';
import { isPrivateChatId } from './utils.js';

export async function loadConfig(state: TelegramState): Promise<void> {
  try {
    const data = await fsPromises.readFile(state.paths.configPath, 'utf8');
    const result = TelegramConfigSchema.safeParse(JSON.parse(data));
    if (result.success) {
      state.config = {
        ...state.config,
        ...result.data,
        authorizedChatIds: [...new Set(result.data.authorizedChatIds)],
      };
    }
  } catch { /* use defaults */ }
}

export async function saveConfig(state: TelegramState): Promise<void> {
  await fsPromises.mkdir(state.paths.configDir, { recursive: true });
  const persisted = {
    botToken: state.config.botToken,
    authorizedChatIds: [...new Set(state.config.authorizedChatIds)],
    responseGate: state.config.responseGate,
    triggerCommand: state.config.triggerCommand,
  };
  await fsPromises.writeFile(state.paths.configTmpPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  await fsPromises.rename(state.paths.configTmpPath, state.paths.configPath);
}

export function isAuthorized(state: TelegramState, chatId: string): boolean {
  return state.config.authorizedChatIds.includes(chatId);
}

export async function authorizeChatId(state: TelegramState, chatId: string): Promise<void> {
  if (!state.config.authorizedChatIds.includes(chatId)) {
    state.config.authorizedChatIds.push(chatId);
  }
  await saveConfig(state);
}

export async function unauthorizeChatId(state: TelegramState, chatId: string): Promise<void> {
  state.config.authorizedChatIds = state.config.authorizedChatIds.filter((id) => id !== chatId);
  for (const [sessionId, mappedChatId] of state.privateChatBySessionId.entries()) {
    if (mappedChatId === chatId) {
      state.privateChatBySessionId.delete(sessionId);
    }
  }
  await saveConfig(state);
}

export function listAuthorizedChatIds(state: TelegramState): string[] {
  return [...new Set(state.config.authorizedChatIds)];
}

export function listAuthorizedPrivateChatIds(state: TelegramState): string[] {
  return listAuthorizedChatIds(state).filter((chatId) => isPrivateChatId(chatId));
}
