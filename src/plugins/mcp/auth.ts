/**
 * MCP OAuth Credential Storage
 * Stores OAuth tokens and client info at ~/.slashbot/config/mcp-auth.json (mode 0o600)
 */

import { HOME_SLASHBOT_DIR } from '../../core/config/constants';
import * as path from 'path';
import { mkdir, chmod } from 'fs/promises';

const AUTH_PATH = path.join(HOME_SLASHBOT_DIR, 'config', 'mcp-auth.json');

export interface MCPAuthEntry {
  serverUrl: string;
  tokens?: {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    obtained_at?: number;
  };
  clientInfo?: {
    client_id: string;
    client_secret?: string;
    [key: string]: unknown;
  };
  codeVerifier?: string;
  oauthState?: string;
}

interface AuthStore {
  entries: Record<string, MCPAuthEntry>;
}

export class MCPAuthStorage {
  private store: AuthStore = { entries: {} };
  private loaded = false;

  async load(): Promise<void> {
    try {
      const file = Bun.file(AUTH_PATH);
      if (await file.exists()) {
        this.store = await file.json();
      }
    } catch {
      this.store = { entries: {} };
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(AUTH_PATH), { recursive: true });
    await Bun.write(AUTH_PATH, JSON.stringify(this.store, null, 2));
    await chmod(AUTH_PATH, 0o600);
  }

  async get(name: string): Promise<MCPAuthEntry | undefined> {
    await this.ensureLoaded();
    return this.store.entries[name];
  }

  async getForUrl(name: string, url: string): Promise<MCPAuthEntry> {
    await this.ensureLoaded();
    if (!this.store.entries[name]) {
      this.store.entries[name] = { serverUrl: url };
    }
    return this.store.entries[name];
  }

  async setTokens(name: string, tokens: MCPAuthEntry['tokens']): Promise<void> {
    await this.ensureLoaded();
    if (!this.store.entries[name]) {
      this.store.entries[name] = { serverUrl: '' };
    }
    this.store.entries[name].tokens = tokens ? { ...tokens, obtained_at: Date.now() } : undefined;
    await this.save();
  }

  async setClientInfo(name: string, clientInfo: MCPAuthEntry['clientInfo']): Promise<void> {
    await this.ensureLoaded();
    if (!this.store.entries[name]) {
      this.store.entries[name] = { serverUrl: '' };
    }
    this.store.entries[name].clientInfo = clientInfo;
    await this.save();
  }

  async setCodeVerifier(name: string, verifier: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.store.entries[name]) {
      this.store.entries[name] = { serverUrl: '' };
    }
    this.store.entries[name].codeVerifier = verifier;
    await this.save();
  }

  async clearCodeVerifier(name: string): Promise<void> {
    await this.ensureLoaded();
    if (this.store.entries[name]) {
      delete this.store.entries[name].codeVerifier;
      await this.save();
    }
  }

  async setOAuthState(name: string, state: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.store.entries[name]) {
      this.store.entries[name] = { serverUrl: '' };
    }
    this.store.entries[name].oauthState = state;
    await this.save();
  }

  async getOAuthState(name: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.store.entries[name]?.oauthState;
  }

  async clearOAuthState(name: string): Promise<void> {
    await this.ensureLoaded();
    if (this.store.entries[name]) {
      delete this.store.entries[name].oauthState;
      await this.save();
    }
  }

  async remove(name: string): Promise<void> {
    await this.ensureLoaded();
    delete this.store.entries[name];
    await this.save();
  }

  isTokenExpired(entry: MCPAuthEntry): boolean {
    if (!entry.tokens?.obtained_at || !entry.tokens?.expires_in) return false;
    const elapsed = (Date.now() - entry.tokens.obtained_at) / 1000;
    return elapsed >= entry.tokens.expires_in - 60; // 60s buffer
  }
}
