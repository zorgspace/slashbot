/**
 * Configuration Manager for Slashbot
 * Handles persistent storage of API keys and settings
 */

import * as path from 'path';
import * as os from 'os';

export interface SlashbotConfig {
  apiKey?: string;
  model?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'slashbot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

export class ConfigManager {
  private config: SlashbotConfig = {};

  async load(): Promise<SlashbotConfig> {
    try {
      // Load credentials (API key)
      const credFile = Bun.file(CREDENTIALS_FILE);
      if (await credFile.exists()) {
        const creds = await credFile.json();
        this.config.apiKey = creds.apiKey;
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

    // Also check environment variables
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    }

    return this.config;
  }

  async saveApiKey(apiKey: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });

    await Bun.write(CREDENTIALS_FILE, JSON.stringify({ apiKey }, null, 2));
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
    try {
      const { unlink } = await import('fs/promises');
      await unlink(CREDENTIALS_FILE);
    } catch {
      // File might not exist
    }
    this.config.apiKey = undefined;
  }

  getApiKey(): string | undefined {
    return this.config.apiKey;
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
}

// Factory function
export function createConfigManager(): ConfigManager {
  return new ConfigManager();
}
