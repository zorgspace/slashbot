import type {
  ConnectorActionSpec,
  ConnectorCapabilities,
  ConnectorSource,
  ConnectorStatus,
} from './base';

export interface ConnectorCatalogEntry {
  id: ConnectorSource;
  label: string;
  description: string;
  capabilities: ConnectorCapabilities;
  actions: ConnectorActionSpec[];
}

const TELEGRAM_CAPABILITIES: ConnectorCapabilities = {
  chatTypes: ['direct', 'group', 'channel', 'thread'],
  supportsMarkdown: true,
  supportsReactions: false,
  supportsEdit: false,
  supportsDelete: false,
  supportsThreads: true,
  supportsTyping: true,
  supportsVoiceInbound: true,
  supportsImageInbound: true,
  supportsMultiTarget: true,
};

const DISCORD_CAPABILITIES: ConnectorCapabilities = {
  chatTypes: ['direct', 'channel', 'thread'],
  supportsMarkdown: true,
  supportsReactions: true,
  supportsEdit: false,
  supportsDelete: false,
  supportsThreads: true,
  supportsTyping: true,
  supportsVoiceInbound: true,
  supportsImageInbound: true,
  supportsMultiTarget: true,
};

const TELEGRAM_ACTIONS: ConnectorActionSpec[] = [
  {
    id: 'send',
    description: 'Send message to active chat',
  },
  {
    id: 'send_to_chat',
    description: 'Send message to a specific authorized chat id',
    requiresTarget: true,
  },
  {
    id: 'configure',
    description: 'Configure bot token and primary chat',
  },
  {
    id: 'authorize_chat',
    description: 'Authorize an additional chat id',
  },
];

const DISCORD_ACTIONS: ConnectorActionSpec[] = [
  {
    id: 'send',
    description: 'Send message to active channel/thread',
  },
  {
    id: 'send_to_channel',
    description: 'Send message to a specific authorized channel',
    requiresTarget: true,
  },
  {
    id: 'thread_create_private',
    description: 'Create a private thread in an authorized text channel',
    requiresTarget: true,
  },
  {
    id: 'thread_create_from_message',
    description: 'Create a thread from an existing message id',
    requiresTarget: true,
  },
  {
    id: 'configure',
    description: 'Configure bot token and primary channel',
  },
  {
    id: 'authorize_channel',
    description: 'Authorize an additional channel id',
  },
];

const CATALOG_BY_ID: Record<string, ConnectorCatalogEntry> = {
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    description: 'Telegram bot connector via Telegraf',
    capabilities: TELEGRAM_CAPABILITIES,
    actions: TELEGRAM_ACTIONS,
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    description: 'Discord bot connector via discord.js',
    capabilities: DISCORD_CAPABILITIES,
    actions: DISCORD_ACTIONS,
  },
};

export function listConnectorCatalogEntries(): ConnectorCatalogEntry[] {
  return Object.values(CATALOG_BY_ID);
}

export function getConnectorCatalogEntry(source: ConnectorSource): ConnectorCatalogEntry | null {
  return CATALOG_BY_ID[String(source)] || null;
}

export function getConnectorCapabilities(source: ConnectorSource): ConnectorCapabilities | null {
  return getConnectorCatalogEntry(source)?.capabilities ?? null;
}

export function getConnectorActionSpecs(source: ConnectorSource): ConnectorActionSpec[] {
  return getConnectorCatalogEntry(source)?.actions ?? [];
}

export function buildDefaultConnectorStatus(source: ConnectorSource): ConnectorStatus {
  return {
    source,
    configured: false,
    running: false,
    authorizedTargets: [],
    notes: ['Not configured'],
  };
}
