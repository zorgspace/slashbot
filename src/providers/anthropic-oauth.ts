/**
 * @module providers/anthropic-oauth
 *
 * Anthropic OAuth 2.0 PKCE authentication handler. Authenticates users
 * via their Claude Pro/Max subscription using the same OAuth flow as
 * Claude Code / OpenClaw. Supports token exchange and automatic refresh.
 *
 * @see {@link createAnthropicOAuthHandler} -- Handler factory
 */

import { randomUUID } from 'node:crypto';
import { generatePkcePair } from '../core/auth/oauth.js';
import type {
  AuthCompleteInput,
  AuthProfile,
  AuthStartContext,
  AuthStartResult,
  ProviderAuthHandler,
} from '../core/kernel/contracts.js';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = 'user:profile user:inference';
/** Buffer subtracted from expires_in to avoid edge-case rejections. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Creates an OAuth PKCE auth handler for Anthropic (Claude Pro/Max subscriptions).
 *
 * The flow redirects to Anthropic's own callback page which displays
 * the authorization code. The user pastes it back into the CLI.
 */
export function createAnthropicOAuthHandler(): ProviderAuthHandler {
  return {
    method: 'oauth_pkce',

    async start(_context: AuthStartContext): Promise<AuthStartResult> {
      const { verifier, challenge, state } = generatePkcePair();

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('code', 'true');
      url.searchParams.set('client_id', CLIENT_ID);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', REDIRECT_URI);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', state);

      return {
        method: 'oauth_pkce',
        authUrl: url.toString(),
        state,
        instructions:
          'Open the URL above in your browser, authorize Slashbot, then paste the code shown on the page.',
        metadata: { verifier, manualCodePaste: true },
      };
    },

    async complete(context: AuthStartContext, input: AuthCompleteInput): Promise<AuthProfile> {
      const code = input.code;
      const verifier = input.verifier;
      const state = input.state;

      if (!code) throw new Error('Missing OAuth authorization code');
      if (!verifier) throw new Error('Missing PKCE verifier');

      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          state: state ?? '',
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic token exchange failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const accessToken = data.access_token as string | undefined;
      const refreshToken = data.refresh_token as string | undefined;
      const expiresIn = data.expires_in as number | undefined;

      if (!accessToken || !refreshToken || !expiresIn) {
        throw new Error('Unexpected token response from Anthropic');
      }

      const expires = Date.now() + expiresIn * 1000 - EXPIRY_BUFFER_MS;

      return {
        profileId: randomUUID(),
        providerId: 'anthropic',
        label: `${context.profileLabel} (OAuth)`,
        method: 'oauth_pkce',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { access: accessToken, refresh: refreshToken, expires },
      };
    },

    async refresh(profile: AuthProfile): Promise<AuthProfile> {
      const refreshToken = profile.data.refresh;
      if (typeof refreshToken !== 'string' || !refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic token refresh failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const accessToken = data.access_token as string | undefined;
      const newRefresh = (data.refresh_token as string | undefined) ?? refreshToken;
      const expiresIn = data.expires_in as number | undefined;

      if (!accessToken || !expiresIn) {
        throw new Error('Unexpected refresh response from Anthropic');
      }

      const expires = Date.now() + expiresIn * 1000 - EXPIRY_BUFFER_MS;

      return {
        ...profile,
        updatedAt: new Date().toISOString(),
        data: { access: accessToken, refresh: newRefresh, expires },
      };
    },
  };
}
