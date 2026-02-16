/**
 * wallet/proxy-auth.ts — Session auth header generation and token-mode proxy auth factory.
 *
 * Exports getSessionAuthHeaders and tokenModeProxyAuth factory.
 * Types: SessionKeypair, WalletSettings, PaymentMode.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import type { TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/index.js';

export type PaymentMode = 'apikey' | 'token';

export interface SessionKeypair {
  publicKey: string;
  secretKey: Uint8Array;
}

export interface WalletSettings {
  paymentMode: PaymentMode;
  proxyBaseUrl?: string;
}

/**
 * Generate Ed25519 auth headers for a proxy request using the active session keypair.
 * Returns null if the session is not active.
 */
export function getSessionAuthHeaders(
  sessionKeypair: SessionKeypair,
  body?: string,
): Record<string, string> {
  const timestamp = Date.now();
  const bodyHash = body ? createHash('sha256').update(body).digest('hex') : undefined;
  const message = bodyHash
    ? `slashbot:${sessionKeypair.publicKey}:${timestamp}:${bodyHash}`
    : `slashbot:${sessionKeypair.publicKey}:${timestamp}`;

  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(sessionKeypair.secretKey.slice(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = sign(null, Buffer.from(message), privateKey).toString('base64');

  const headers: Record<string, string> = {
    'X-Wallet-Address': sessionKeypair.publicKey,
    'X-Wallet-Signature': signature,
    'X-Wallet-Timestamp': String(timestamp),
  };

  if (bodyHash) {
    headers['X-Body-Hash'] = bodyHash;
  }

  return headers;
}

export interface TokenModeProxyAuthDeps {
  readSettings: () => Promise<WalletSettings>;
  readWalletPublicKey: () => Promise<string | null>;
  isSessionActive: () => boolean;
  getActiveSessionKeypair: () => SessionKeypair | null;
  resolveProxyBaseUrl: (settings: WalletSettings) => string;
  refreshSessionExpiry: () => void;
}

/**
 * Create a TokenModeProxyAuthService that delegates to the provided dependencies
 * for session and wallet state.
 */
export function createTokenModeProxyAuth(deps: TokenModeProxyAuthDeps): TokenModeProxyAuthService {
  return {
    resolveProxyRequest: async (requestBody: string) => {
      const settings = await deps.readSettings();

      if (settings.paymentMode !== 'token') {
        return { enabled: false };
      }

      const publicKey = await deps.readWalletPublicKey();
      if (!publicKey) {
        return {
          enabled: false,
          reason: 'Token mode is enabled but no wallet is configured. Run: solana create or solana import.',
        };
      }

      if (!deps.isSessionActive()) {
        return {
          enabled: false,
          reason: 'Token mode is enabled but wallet session is locked. Run: solana unlock <password>.',
        };
      }

      const keypair = deps.getActiveSessionKeypair();
      if (!keypair) {
        return {
          enabled: false,
          reason: 'Token mode is enabled but wallet session expired. Run: solana unlock <password>.',
        };
      }

      deps.refreshSessionExpiry();
      const headers = getSessionAuthHeaders(keypair, requestBody);

      const baseRoot = deps.resolveProxyBaseUrl(settings).replace(/\/+$/, '');
      return {
        enabled: true,
        baseUrl: `${baseRoot}/api/grok`,
        headers,
      };
    },
  };
}
