/**
 * @module oauth
 *
 * Provides OAuth 2.0 PKCE (Proof Key for Code Exchange) utilities used by
 * provider auth handlers during the OAuth authorization flow. Generates
 * cryptographically secure verifier/challenge pairs and state tokens.
 *
 * Key exports:
 * - {@link generatePkcePair} - Generates a PKCE verifier, challenge, and state token
 */
import { createHash, randomBytes } from 'node:crypto';

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generates a PKCE (Proof Key for Code Exchange) pair for OAuth 2.0 flows.
 *
 * @returns An object containing the base64url-encoded `verifier`, the SHA-256
 *          `challenge` derived from it, and a random `state` parameter.
 */
export function generatePkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  return { verifier, challenge, state };
}
