/**
 * OAuthClientProvider implementation for MCP SDK
 * Uses MCPAuthStorage for persistent credential storage
 */

import type { OAuthClientProvider as IOAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { MCPAuthStorage } from './auth';
import type { MCPOAuthConfig } from './types';

const CALLBACK_PORT = 19877;
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}/mcp/oauth/callback`;

export class MCPOAuthProvider implements IOAuthClientProvider {
  constructor(
    private serverName: string,
    private serverUrl: string,
    private authStorage: MCPAuthStorage,
    private oauthConfig?: MCPOAuthConfig,
    private onRedirect?: (url: URL) => void,
  ) {}

  get redirectUrl(): string {
    return REDIRECT_URL;
  }

  get clientMetadata() {
    return {
      redirect_uris: [REDIRECT_URL],
      token_endpoint_auth_method: 'none' as const,
      grant_types: ['authorization_code' as const, 'refresh_token' as const],
      response_types: ['code' as const],
      client_name: `slashbot-${this.serverName}`,
      client_uri: 'https://github.com/zorgspace/slashbot',
    };
  }

  async clientInformation() {
    const entry = await this.authStorage.get(this.serverName);
    if (!entry?.clientInfo) return undefined;
    return entry.clientInfo as any;
  }

  async saveClientInformation(info: any): Promise<void> {
    await this.authStorage.setClientInfo(this.serverName, info);
  }

  async tokens() {
    const entry = await this.authStorage.get(this.serverName);
    if (!entry?.tokens) return undefined;
    return entry.tokens as any;
  }

  async saveTokens(tokens: any): Promise<void> {
    await this.authStorage.setTokens(this.serverName, tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.onRedirect) {
      this.onRedirect(authorizationUrl);
    } else {
      console.log(`[MCP:${this.serverName}] Authorize at: ${authorizationUrl}`);
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.authStorage.setCodeVerifier(this.serverName, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const entry = await this.authStorage.get(this.serverName);
    return entry?.codeVerifier ?? '';
  }

  async state(): Promise<string> {
    const s = await this.authStorage.getOAuthState(this.serverName);
    if (s) return s;
    const newState = crypto.randomUUID();
    await this.authStorage.setOAuthState(this.serverName, newState);
    return newState;
  }
}
