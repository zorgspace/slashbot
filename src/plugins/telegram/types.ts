import { z } from 'zod';
import type { ConnectorAgentSession } from '../services/connector-agent';

// ── Constants ───────────────────────────────────────────────────────

export const PLUGIN_ID = 'slashbot.channel.telegram';
export const DEFAULT_AGENT_ID = 'default-agent';
export const PRIVATE_AGENTIC_MAX_RESPONSE_TOKENS = 6144;

// ── Zod schema ──────────────────────────────────────────────────────

export const TelegramConfigSchema = z.object({
  botToken: z.string().optional(),
  authorizedChatIds: z.array(z.string()).default([]),
  responseGate: z.enum(['open', 'command']).default('open'),
  triggerCommand: z.string().default('/chat'),
});

// ── Types ───────────────────────────────────────────────────────────

export type ResponseGate = 'open' | 'command';
export type ConnectorStatus = 'connected' | 'busy' | 'disconnected';
export type TelegramMessageDirection = 'in' | 'out';
export type TelegramMessageModality = 'text' | 'voice' | 'photo';

export interface TelegramConfig {
  botToken?: string;
  authorizedChatIds: string[];
  responseGate: ResponseGate;
  triggerCommand: string;
}

export interface TelegramChatRef {
  id: number | string;
  type?: string;
}

export interface TelegramPaths {
  configDir: string;
  configPath: string;
  configTmpPath: string;
  lockPath: string;
  locksDirPath: string;
  legacyChatStatePath: string;
}

export interface TelegramState {
  bot: import('telegraf').Telegraf | null;
  status: ConnectorStatus;
  config: TelegramConfig;
  agentSession: ConnectorAgentSession | null;
  privateAgentSession: ConnectorAgentSession | null;
  updateIndicatorStatus: ((s: ConnectorStatus) => void) | null;
  lastCommandHintByChat: Map<string, number>;
  privateChatBySessionId: Map<string, string>;
  paths: TelegramPaths;
}
