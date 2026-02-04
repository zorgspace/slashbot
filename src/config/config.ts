/**
 * Configuration Manager for Slashbot
 * Handles persistent storage of API keys and settings
 *
 * Credentials are stored in ~/.slashbot (home directory) for global access
 */

import { HOME_SLASHBOT_DIR, HOME_CONFIG_FILE } from '../constants';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface DiscordConfig {
  botToken: string;
  channelId: string; // Primary channel
  channelIds?: string[]; // Additional authorized channels
  ownerId?: string; // Owner user ID for private threads
}

export interface SlashbotConfig {
  apiKey?: string;
  openaiApiKey?: string;
  model?: string;
  paymentMode?: string;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
}

// Use home directory for credentials (shared across all projects)
const CONFIG_DIR = HOME_SLASHBOT_DIR;
const CONFIG_FILE = HOME_CONFIG_FILE;
const CREDENTIALS_FILE = `${HOME_SLASHBOT_DIR}/credentials.json`;

export class ConfigManager {
  private config: SlashbotConfig = {};
  private telegram: TelegramConfig | null = null;
  private discord: DiscordConfig | null = null;

  async load(): Promise<SlashbotConfig> {
    try {
      // Load credentials (API keys + connectors)
      const credFile = Bun.file(CREDENTIALS_FILE);
      if (await credFile.exists()) {
        const creds = await credFile.json();
        this.config.apiKey = creds.apiKey;
        this.config.openaiApiKey = creds.openaiApiKey;
        if (creds.telegram?.botToken && creds.telegram?.chatId) {
          this.telegram = creds.telegram;
        }
        if (creds.discord?.botToken && creds.discord?.channelId) {
          this.discord = creds.discord;
        }
      }

      // Load general config
      const configFile = Bun.file(CONFIG_FILE);
      if (await configFile.exists()) {
        const cfg = await configFile.json();
        this.config = { ...this.config, ...cfg };
      }
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

    return this.config;
  }

  async saveApiKey(apiKey: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    // Preserve telegram config when saving API key
    const creds: any = { apiKey };
    if (this.telegram) {
      creds.telegram = this.telegram;
    }
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
    this.config.apiKey = apiKey;
  }

  async saveConfig(config: Partial<SlashbotConfig>): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    // Don't save API key in main config file
    const { apiKey, ...rest } = config;
    const toSave = { ...this.config, ...rest };
    delete (toSave as any).apiKey;

    await Bun.write(CONFIG_FILE, JSON.stringify(toSave, null, 2));
    this.config = { ...this.config, ...config };
  }

  async clearApiKey(): Promise<void> {
    // Preserve telegram config when clearing API key
    if (this.telegram) {
      const { mkdir } = await import('fs/promises');
      await mkdir(CONFIG_DIR, { recursive: true });
      await Bun.write(CREDENTIALS_FILE, JSON.stringify({ telegram: this.telegram }, null, 2));
    } else {
      try {
        const { unlink } = await import('fs/promises');
        await unlink(CREDENTIALS_FILE);
      } catch {
        // File might not exist
      }
    }
    this.config.apiKey = undefined;
  }

  async saveTelegramConfig(botToken: string, chatId: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    this.telegram = { botToken, chatId };

    // Preserve API key when saving telegram config
    const creds: any = { telegram: this.telegram };
    if (this.config.apiKey) {
      creds.apiKey = this.config.apiKey;
    }
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  }

  async clearTelegramConfig(): Promise<void> {
    this.telegram = null;

    // Rewrite credentials without telegram
    if (this.config.apiKey) {
      const { mkdir } = await import('fs/promises');
      await mkdir(CONFIG_DIR, { recursive: true });
      await Bun.write(CREDENTIALS_FILE, JSON.stringify({ apiKey: this.config.apiKey }, null, 2));
    }
  }

  getApiKey(): string | undefined {
    return this.config.apiKey;
  }

  getOpenAIApiKey(): string | undefined {
    return this.config.openaiApiKey;
  }

  async saveOpenAIApiKey(apiKey: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    this.config.openaiApiKey = apiKey;

    // Load existing credentials and merge
    let creds: any = {};
    try {
      const credFile = Bun.file(CREDENTIALS_FILE);
      if (await credFile.exists()) {
        creds = await credFile.json();
      }
    } catch {}

    creds.openaiApiKey = apiKey;
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  }

  getConfig(): SlashbotConfig {
    return { ...this.config };
  }

  isAuthenticated(): boolean {
    return !!this.config.apiKey;
  }

  getConfigDir(): string {
    return CONFIG_DIR;
  }

  getTelegramConfig(): TelegramConfig | null {
    return this.telegram;
  }

  async saveDiscordConfig(botToken: string, channelId: string, channelIds?: string[], ownerId?: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    this.discord = { botToken, channelId };
    if (channelIds && channelIds.length > 0) {
      this.discord.channelIds = channelIds;
    }
    if (ownerId) {
      this.discord.ownerId = ownerId;
    }

    // Preserve other credentials
    const creds: any = { discord: this.discord };
    if (this.config.apiKey) creds.apiKey = this.config.apiKey;
    if (this.telegram) creds.telegram = this.telegram;
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
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
        this.discord.ownerId
      );
    }
  }

  async removeDiscordChannel(channelId: string): Promise<boolean> {
    if (!this.discord || !this.discord.channelIds) {
      return false;
    }

    // Don't remove primary channel
    if (channelId === this.discord.channelId) {
      return false;
    }

    const idx = this.discord.channelIds.indexOf(channelId);
    if (idx > -1) {
      this.discord.channelIds.splice(idx, 1);
      await this.saveDiscordConfig(
        this.discord.botToken,
        this.discord.channelId,
        this.discord.channelIds,
        this.discord.ownerId
      );
      return true;
    }
    return false;
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
      ownerId
    );
  }

  async clearDiscordConfig(): Promise<void> {
    this.discord = null;

    // Rewrite credentials without discord
    const creds: any = {};
    if (this.config.apiKey) creds.apiKey = this.config.apiKey;
    if (this.telegram) creds.telegram = this.telegram;

    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  }

  getDiscordConfig(): DiscordConfig | null {
    return this.discord;
  }
}

// Factory function
export function createConfigManager(): ConfigManager {
  return new ConfigManager();
}
