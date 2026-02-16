import { z } from 'zod';
import type { ConnectorAgentSession } from '../services/connector-agent.js';

// ── Constants ───────────────────────────────────────────────────────

export const PLUGIN_ID = 'slashbot.channel.discord';
export const DEFAULT_AGENT_ID = 'default-agent';
export const DM_AGENTIC_TIMEOUT_MS = 300_000;
export const DM_AGENTIC_MAX_RESPONSE_TOKENS = 6144;
export const DISCORD_MESSAGE_LIMIT = 2000;
export const TYPING_INTERVAL_MS = 8000;

// ── Zod schema ──────────────────────────────────────────────────────

export const DiscordConfigSchema = z.object({
  botToken: z.string().optional(),
  authorizedChannelIds: z.array(z.string()).default([]),
  primaryChannelId: z.string().optional(),
  ownerId: z.string().optional(),
});

// ── Types ───────────────────────────────────────────────────────────

export type ConnectorStatus = 'connected' | 'busy' | 'disconnected';
export type DiscordMessageDirection = 'in' | 'out';
export type DiscordMessageModality = 'text' | 'voice' | 'photo';

export interface DiscordConfig {
  botToken?: string;
  authorizedChannelIds: string[];
  primaryChannelId?: string;
  ownerId?: string;
}

export interface DiscordPaths {
  configDir: string;
  configPath: string;
  configTmpPath: string;
  lockPath: string;
  locksDirPath: string;
}

export interface DiscordState {
  client: import('discord.js').Client | null;
  status: ConnectorStatus;
  config: DiscordConfig;
  agentSession: ConnectorAgentSession | null;
  dmAgentSession: ConnectorAgentSession | null;
  updateIndicatorStatus: ((s: ConnectorStatus) => void) | null;
  dmChannelBySessionId: Map<string, string>;
  pendingJobsByChannel: Map<string, Array<() => Promise<void>>>;
  processingChannels: Set<string>;
  paths: DiscordPaths;
}
