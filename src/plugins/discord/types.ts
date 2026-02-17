/**
 * @module plugins/discord/types
 *
 * Shared constants, Zod schemas, and TypeScript type definitions for the
 * Discord connector plugin. Defines the plugin ID, message limits,
 * configuration schema, and the mutable state shape used across all
 * Discord plugin modules.
 *
 * @see {@link DiscordState} - Central mutable state interface
 * @see {@link DiscordConfig} - Persisted configuration shape
 * @see {@link DiscordConfigSchema} - Zod validator for config files
 */
import { z } from 'zod';
import type { ConnectorAgentSession } from '../services/connector-agent.js';

// ── Constants ───────────────────────────────────────────────────────

/** Unique plugin identifier for the Discord connector. */
export const PLUGIN_ID = 'slashbot.channel.discord';
/** Default agent ID used when no explicit agent routing is specified. */
export const DEFAULT_AGENT_ID = 'default-agent';
/** Maximum response tokens for agentic DM sessions. */
export const DM_AGENTIC_MAX_RESPONSE_TOKENS = 6144;
/** Maximum character count for a single Discord message. */
export const DISCORD_MESSAGE_LIMIT = 2000;
/** Interval in milliseconds between typing indicator pings. */
export const TYPING_INTERVAL_MS = 8000;

// ── Zod schema ──────────────────────────────────────────────────────

/** Zod schema for validating Discord config files loaded from disk. */
export const DiscordConfigSchema = z.object({
  botToken: z.string().optional(),
  authorizedChannelIds: z.array(z.string()).default([]),
  primaryChannelId: z.string().optional(),
  ownerId: z.string().optional(),
});

// ── Types ───────────────────────────────────────────────────────────

/** Possible states of the Discord connector lifecycle. */
export type ConnectorStatus = 'connected' | 'busy' | 'disconnected';
/** Direction of a Discord message event (inbound or outbound). */
export type DiscordMessageDirection = 'in' | 'out';
/** Content modality of a Discord message. */
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
  paths: DiscordPaths;
}
