/**
 * Base Connector Interface
 * All platform connectors implement this interface
 */

import type { EventBus } from '../core/events/EventBus';

export type ConnectorSource = 'cli' | 'telegram' | 'discord' | (string & {});
export type ConnectorChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface MessageMetadata {
  /** Message was already displayed (e.g., transcription result) */
  alreadyDisplayed?: boolean;
  /** Session/channel ID for multi-channel support */
  sessionId?: string;
  /** Chat ID for targeted replies */
  chatId?: string;
}

export type MessageHandler = (
  message: string,
  source: ConnectorSource,
  metadata?: MessageMetadata,
) => Promise<string | void>;

export interface ConnectorConfig {
  /** Max message length for this platform */
  maxMessageLength: number;
  /** Whether the platform supports markdown */
  supportsMarkdown: boolean;
  /** Whether to use concise responses */
  conciseMode: boolean;
}

export interface ConnectorCapabilities {
  chatTypes: ConnectorChatType[];
  supportsMarkdown: boolean;
  supportsReactions: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
  supportsThreads: boolean;
  supportsTyping: boolean;
  supportsVoiceInbound: boolean;
  supportsImageInbound: boolean;
  supportsMultiTarget: boolean;
}

export interface ConnectorActionSpec {
  id: string;
  description: string;
  requiresTarget?: boolean;
}

export interface ConnectorStatus {
  source: ConnectorSource;
  configured: boolean;
  running: boolean;
  primaryTarget?: string;
  activeTarget?: string;
  authorizedTargets: string[];
  ownerId?: string;
  notes?: string[];
}

export interface Connector {
  readonly source: ConnectorSource;
  readonly config: ConnectorConfig;

  setMessageHandler(handler: MessageHandler): void;
  setEventBus?(eventBus: EventBus): void;
  start(): Promise<void>;
  stop(): void;
  sendMessage(text: string): Promise<void>;
  isRunning(): boolean;
  getCapabilities?(): ConnectorCapabilities;
  listSupportedActions?(): ConnectorActionSpec[];
  getStatus?(): ConnectorStatus;
}

/** Platform-specific configs */
export const PLATFORM_CONFIGS: Record<ConnectorSource, ConnectorConfig> = {
  cli: {
    maxMessageLength: Infinity,
    supportsMarkdown: true,
    conciseMode: false,
  },
  telegram: {
    maxMessageLength: 4000,
    supportsMarkdown: true,
    conciseMode: true,
  },
  discord: {
    maxMessageLength: 2000,
    supportsMarkdown: true,
    conciseMode: true,
  },
};

/**
 * Split a message into chunks respecting platform limits
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Fall back to space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
