/**
 * Configuration Manager for Slashbot
 * Handles persistent storage of API keys and settings
 *
 * Credentials are stored in ~/.slashbot (home directory) for global access
 * - credentials.json: all secrets (API keys, provider creds, bot tokens)
 * Non-secret config is loaded hierarchically:
 * - ~/.slashbot/config/config.json (global defaults)
 * - ./.slashbot/config/config.json (cwd overrides)
 */

import {
  HOME_CONFIG_FILE,
  HOME_CREDENTIALS_FILE,
  HOME_SLASHBOT_DIR,
  getLocalConfigDir,
  getLocalConfigFile,
  getLocalSlashbotDir,
} from './constants';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  chatIds?: string[];
  triggerCommand?: string;
  responseGate?: 'open' | 'command';
}

export interface DiscordConfig {
  botToken: string;
  channelId: string; // Primary channel
  channelIds?: string[]; // Additional authorized channels
  ownerId?: string; // Owner user ID for private threads
}

export interface ProviderCredentials {
  apiKey: string;
  baseUrl?: string;
}

export interface SlashbotConfig {
  apiKey?: string;
  openaiApiKey?: string;
  provider?: string;
  model?: string;
  paymentMode?: string;
  providers?: Record<string, ProviderCredentials>;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
}

// Credentials live in home and are shared across projects.
const LOCAL_SLASHBOT_DIR = getLocalSlashbotDir();
const LOCAL_CONFIG_FILE = getLocalConfigFile();
const LOCAL_CREDENTIALS_FILE = `${LOCAL_SLASHBOT_DIR}/credentials.json`;
const CREDENTIALS_FILE = HOME_CREDENTIALS_FILE;
const CREDENTIALS_DIR = HOME_SLASHBOT_DIR;

export class ConfigManager {
  private config: SlashbotConfig = {};
  private telegram: TelegramConfig | null = null;
  private discord: DiscordConfig | null = null;

  // ===== Credential file helpers (load-merge-save) =====

  private async readHomeCredentials(): Promise<Record<string, any>> {
    try {
      const credFile = Bun.file(HOME_CREDENTIALS_FILE);
      if (await credFile.exists()) {
        return await credFile.json();
      }
    } catch {}
    return {};
  }

  private async readLocalCredentials(): Promise<Record<string, any>> {
    try {
      const credFile = Bun.file(LOCAL_CREDENTIALS_FILE);
      if (await credFile.exists()) {
        return await credFile.json();
      }
    } catch {}
    return {};
  }

  private async readMergedCredentials(): Promise<Record<string, any>> {
    const homeCreds = await this.readHomeCredentials();
    const localCreds = await this.readLocalCredentials();
    Object.assign(homeCreds, localCreds);
    return homeCreds;
  }

  // Backward-compatible alias used by legacy call sites.
  private async readCredentials(): Promise<Record<string, any>> {
    return this.readMergedCredentials();
  }

  private async writeCredentials(creds: Record<string, any>): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CREDENTIALS_DIR, { recursive: true });
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  }

  private async mergeCredentials(updates: Record<string, any>): Promise<void> {
    const creds = await this.readCredentials();
    Object.assign(creds, updates);
    // Remove null/undefined keys
    for (const key of Object.keys(creds)) {
      if (creds[key] === null || creds[key] === undefined) {
        delete creds[key];
      }
    }
    await this.writeCredentials(creds);
  }

  private sanitizeNonSecretConfig(raw: unknown): Partial<SlashbotConfig> {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const cfg = raw as Record<string, unknown>;
    const {
      apiKey: _a,
      openaiApiKey: _o,
      providers: _p,
      telegram: _t,
      discord: _d,
      ...safeConfig
    } = cfg;
    return safeConfig as Partial<SlashbotConfig>;
  }

  private async readNonSecretConfig(filePath: string): Promise<Partial<SlashbotConfig>> {
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return this.sanitizeNonSecretConfig(await file.json());
      }
    } catch {}
    return {};
  }

  // ===== Load =====

  async load(): Promise<SlashbotConfig> {
    this.config = {};
    try {
      // Load credentials (API keys, providers, connectors)
      const creds = await this.readMergedCredentials();
      this.config.apiKey = creds.apiKey;
      this.config.openaiApiKey = creds.openaiApiKey;
      if (creds.providers && typeof creds.providers === 'object') {
        this.config.providers = creds.providers;
      }
      if (creds.telegram?.botToken && creds.telegram?.chatId) {
        this.telegram = creds.telegram;
      }
      if (creds.discord?.botToken && creds.discord?.channelId) {
        this.discord = creds.discord;
      }

      // Load non-secret config hierarchically (global defaults -> local overrides)
      const globalConfig = await this.readNonSecretConfig(HOME_CONFIG_FILE);
      const localConfig = await this.readNonSecretConfig(LOCAL_CONFIG_FILE);
      this.config = { ...this.config, ...globalConfig, ...localConfig };
    } catch {
      // Config doesn't exist yet
    }

    // Also check environment variables for API keys
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    }
    if (!this.config.openaiApiKey) {
      this.config.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // Auto-detect provider credentials from environment
    if (!this.config.providers) {
      this.config.providers = {};
    }
    const envProviderMap: Record<string, string[]> = {
      xai: ['XAI_API_KEY', 'GROK_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    };
    for (const [provider, envVars] of Object.entries(envProviderMap)) {
      if (this.config.providers[provider]) continue;
      for (const envVar of envVars) {
        const key = process.env[envVar];
        if (key) {
          this.config.providers[provider] = { apiKey: key };
          break;
        }
      }
    }

    const providerCreds =
      this.config.provider && this.config.providers?.[this.config.provider]
        ? this.config.providers[this.config.provider]
        : undefined;
    if (providerCreds?.apiKey) {
      this.config.apiKey = providerCreds.apiKey;
    } else if (this.config.apiKey && this.config.provider) {
      // Reconcile: if main apiKey's provider doesn't match config.provider, auto-correct
      // This fixes stale config.json from before the multi-provider persistence fix
      const keyProvider = inferProviderFromApiKey(this.config.apiKey);
      if (keyProvider && keyProvider !== this.config.provider) {
        this.config.provider = keyProvider;
        // Clear stale model from the wrong provider
        this.config.model = undefined;
      }
    }

    return this.config;
  }

  // ===== API Key =====

  async saveApiKey(apiKey: string): Promise<void> {
    this.config.apiKey = apiKey;
    await this.mergeCredentials({ apiKey });
  }

  async clearApiKey(): Promise<void> {
    this.config.apiKey = undefined;
    await this.mergeCredentials({ apiKey: null });
  }

  getApiKey(): string | undefined {
    return this.config.apiKey;
  }

  // ===== Provider Credentials =====

  async saveProviderCredentials(providerId: string, creds: ProviderCredentials): Promise<void> {
    if (!this.config.providers) {
      this.config.providers = {};
    }
    this.config.providers[providerId] = creds;
    // Read existing, merge providers, write back
    const existing = await this.readCredentials();
    if (!existing.providers || typeof existing.providers !== 'object') {
      existing.providers = {};
    }
    existing.providers[providerId] = creds;
    await this.writeCredentials(existing);
  }

  getProvider(): string {
    return this.config.provider || 'xai';
  }

  getProviderCredentials(providerId: string): ProviderCredentials | undefined {
    return this.config.providers?.[providerId];
  }

  getAllProviderCredentials(): Record<string, ProviderCredentials> {
    return { ...this.config.providers };
  }

  // ===== General Config (non-secret) =====

  async saveConfig(config: Partial<SlashbotConfig>): Promise<void> {
    const { mkdir } = await import('fs/promises');
    const configDir = getLocalConfigDir();
    await mkdir(configDir, { recursive: true });

    // Separate secrets from non-secret config
    const { apiKey, openaiApiKey, providers, telegram, discord, ...nonSecretUpdates } = config;

    // Save only local non-secret overrides, without copying global defaults.
    const localNonSecret = await this.readNonSecretConfig(LOCAL_CONFIG_FILE);
    const toSave = { ...localNonSecret, ...nonSecretUpdates };
    await Bun.write(LOCAL_CONFIG_FILE, JSON.stringify(toSave, null, 2));

    // If secrets were passed, route them to credentials.json
    if (apiKey !== undefined || openaiApiKey !== undefined || providers !== undefined) {
      const credUpdates: Record<string, any> = {};
      if (apiKey !== undefined) credUpdates.apiKey = apiKey;
      if (openaiApiKey !== undefined) credUpdates.openaiApiKey = openaiApiKey;
      if (providers !== undefined) {
        const existing = await this.readCredentials();
        credUpdates.providers = { ...(existing.providers || {}), ...providers };
      }
      await this.mergeCredentials(credUpdates);
    }

    this.config = { ...this.config, ...config };
  }

  getConfig(): SlashbotConfig {
    return { ...this.config };
  }

  isAuthenticated(): boolean {
    return !!this.config.apiKey;
  }

  getConfigDir(): string {
    return LOCAL_SLASHBOT_DIR;
  }

  // ===== OpenAI API Key =====

  async saveOpenAIApiKey(apiKey: string): Promise<void> {
    this.config.openaiApiKey = apiKey;
    await this.mergeCredentials({ openaiApiKey: apiKey });
  }

  getOpenAIApiKey(): string | undefined {
    return this.config.openaiApiKey;
  }

  // ===== Telegram =====

  async saveTelegramConfig(
    botToken: string,
    chatId: string,
    chatIds?: string[],
    triggerCommand?: string,
    responseGate?: 'open' | 'command',
  ): Promise<void> {
    if (!this.telegram) {
      this.telegram = { botToken, chatId };
    } else {
      this.telegram.botToken = botToken;
      this.telegram.chatId = chatId;
    }
    if (chatIds !== undefined) {
      this.telegram.chatIds = chatIds || [];
    }
    if (triggerCommand !== undefined) {
      this.telegram!.triggerCommand = triggerCommand;
    }
    if (responseGate !== undefined) {
      this.telegram!.responseGate = responseGate;
    }
    await this.mergeCredentials({ telegram: this.telegram! });
  }

  async clearTelegramConfig(): Promise<void> {
    this.telegram = null;
    await this.mergeCredentials({ telegram: null });
  }

  getTelegramConfig(): TelegramConfig | null {
    return this.telegram;
  }

  async addTelegramChat(chatId: string): Promise<void> {
    if (!this.telegram) {
      throw new Error('Telegram not configured');
    }

    if (!this.telegram.chatIds) {
      this.telegram.chatIds = [];
    }

    if (!this.telegram.chatIds.includes(chatId) && chatId !== this.telegram.chatId) {
      this.telegram.chatIds.push(chatId);
      await this.saveTelegramConfig(
        this.telegram.botToken,
        this.telegram.chatId,
        this.telegram.chatIds,
      );
    }
  }

  async removeTelegramChat(chatId: string): Promise<void> {
    if (!this.telegram) {
      throw new Error('Telegram not configured');
    }

    if (chatId === this.telegram.chatId) {
      throw new Error('Cannot remove the primary chat ID');
    }

    if (this.telegram.chatIds) {
      this.telegram.chatIds = this.telegram.chatIds.filter(id => id !== chatId);
      await this.saveTelegramConfig(
        this.telegram.botToken,
        this.telegram.chatId,
        this.telegram.chatIds,
      );
    }
  }

  async setTelegramPrimaryChat(chatId: string): Promise<void> {
    if (!this.telegram) {
      throw new Error('Telegram not configured');
    }

    const nextSet = new Set<string>(this.telegram.chatIds ?? []);
    nextSet.add(this.telegram.chatId);
    nextSet.delete(chatId);
    this.telegram.chatId = chatId;
    this.telegram.chatIds = Array.from(nextSet);
    await this.saveTelegramConfig(
      this.telegram.botToken,
      this.telegram.chatId,
      this.telegram.chatIds,
    );
  }

  // ===== Discord =====

  async saveDiscordConfig(
    botToken: string,
    channelId: string,
    channelIds?: string[],
    ownerId?: string,
  ): Promise<void> {
    this.discord = { botToken, channelId };
    if (channelIds && channelIds.length > 0) {
      this.discord.channelIds = channelIds;
    }
    if (ownerId) {
      this.discord.ownerId = ownerId;
    }
    await this.mergeCredentials({ discord: this.discord });
  }

  async addDiscordChannel(channelId: string): Promise<void> {
    if (!this.discord) {
      throw new Error('Discord not configured');
    }

    if (!this.discord.channelIds) {
      this.discord.channelIds = [];
    }

    if (!this.discord.channelIds.includes(channelId) && channelId !== this.discord.channelId) {
      this.discord.channelIds.push(channelId);
      await this.saveDiscordConfig(
        this.discord.botToken,
        this.discord.channelId,
        this.discord.channelIds,
        this.discord.ownerId,
      );
    }
  }

  async removeDiscordChannel(channelId: string): Promise<void> {
    if (!this.discord) {
      throw new Error('Discord not configured');
    }

    if (channelId === this.discord.channelId) {
      throw new Error('Cannot remove the primary channel ID');
    }

    if (this.discord.channelIds) {
      this.discord.channelIds = this.discord.channelIds.filter(id => id !== channelId);
      await this.saveDiscordConfig(
        this.discord.botToken,
        this.discord.channelId,
        this.discord.channelIds,
        this.discord.ownerId,
      );
    }
  }

  async setDiscordPrimaryChannel(channelId: string): Promise<void> {
    if (!this.discord) {
      throw new Error('Discord not configured');
    }

    const nextSet = new Set<string>(this.discord.channelIds ?? []);
    nextSet.add(this.discord.channelId);
    nextSet.delete(channelId);
    this.discord.channelId = channelId;
    this.discord.channelIds = Array.from(nextSet);
    await this.saveDiscordConfig(
      this.discord.botToken,
      this.discord.channelId,
      this.discord.channelIds,
      this.discord.ownerId,
    );
  }

  async setDiscordOwnerId(ownerId: string): Promise<void> {
    if (!this.discord) {
      throw new Error('Discord not configured');
    }

    this.discord.ownerId = ownerId;
    await this.saveDiscordConfig(
      this.discord.botToken,
      this.discord.channelId,
      this.discord.channelIds,
      ownerId,
    );
  }

  async clearDiscordConfig(): Promise<void> {
    this.discord = null;
    await this.mergeCredentials({ discord: null });
  }

  getDiscordConfig(): DiscordConfig | null {
    return this.discord;
  }
}

// Factory function
export function createConfigManager(): ConfigManager {
  return new ConfigManager();
}

/** Infer provider from API key prefix */
function inferProviderFromApiKey(apiKey: string): string | undefined {
  if (apiKey.startsWith('xai-')) return 'xai';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  if (apiKey.startsWith('AIza')) return 'google';
  return undefined;
}
