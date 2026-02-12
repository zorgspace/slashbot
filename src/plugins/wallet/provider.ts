/**
 * Proxy Auth Provider - Implements ApiAuthProvider for proxy/solana billing mode.
 *
 * Handles wallet-based authentication, token validation, balance checks,
 * and billing info capture from proxy responses.
 */

import type { ApiAuthProvider } from '../../core/api/types';
import { PROXY_CONFIG } from '../../core/config/constants';
import { getSessionAuthHeaders, walletExists, getBalances, getPublicKey } from './services';

/** Billing info returned by proxy */
export interface BillingInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: {
    usd: number;
    credits: number;
  };
  processingTime: number;
}

/** Balance info from proxy */
export interface BalanceInfo {
  walletAddress: string;
  credits: number;
  lastUpdated: string;
}

/**
 * Custom error for token mode validation failures
 */
export class TokenModeError extends Error {
  details: string;
  constructor(message: string, details: string) {
    super(message);
    this.name = 'TokenModeError';
    this.details = details;
  }
}

/** Payment mode state - managed by wallet plugin */
let currentPaymentMode: 'apikey' | 'token' = 'apikey';

export function setPaymentMode(mode: 'apikey' | 'token'): void {
  currentPaymentMode = mode;
}

export function getPaymentMode(): string {
  return currentPaymentMode;
}

/**
 * Check if proxy mode should be used based on current payment mode and wallet config
 */
export function useProxy(): boolean {
  if (currentPaymentMode !== 'token') return false;
  const proxyUrl = PROXY_CONFIG.BASE_URL;
  const walletAddress = getPublicKey();
  return !!(proxyUrl && walletAddress);
}

/**
 * Get credit balance from proxy (proxy mode only)
 */
export async function getBalance(): Promise<BalanceInfo | null> {
  if (!useProxy()) return null;

  const proxyUrl = PROXY_CONFIG.BASE_URL;
  const walletAddress = getPublicKey();

  try {
    const response = await fetch(
      `${proxyUrl}${PROXY_CONFIG.CREDITS_ENDPOINT}?wallet=${walletAddress}`,
    );
    if (!response.ok) return null;
    return (await response.json()) as BalanceInfo;
  } catch {
    return null;
  }
}

/**
 * Validate token mode requirements and throw TokenModeError if not met
 */
async function validateTokenMode(): Promise<void> {
  if (!walletExists()) {
    throw new TokenModeError(
      'No wallet configured.',
      'Run /solana create or /solana import first, or switch to /solana mode apikey.',
    );
  }

  if (!useProxy()) {
    throw new TokenModeError(
      'Token mode misconfigured.',
      'Switch to /solana mode apikey or reconfigure wallet.',
    );
  }

  const balances = await getBalances();
  if (!balances || balances.slashbot <= 0) {
    const credits = await getBalance();
    if (!credits || credits.credits <= 0) {
      throw new TokenModeError(
        'No SLASHBOT tokens or credits available.',
        'Buy SLASHBOT tokens or switch to /solana mode apikey.',
      );
    }
    return;
  }

  const credits = await getBalance();
  if (!credits || credits.credits <= 0) {
    throw new TokenModeError(
      'No credits available.',
      'Run /solana redeem <amount> to convert SLASHBOT tokens to credits.',
    );
  }
}

/**
 * ProxyAuthProvider - routes requests through the billing proxy with wallet auth.
 */
export class ProxyAuthProvider implements ApiAuthProvider {
  private lastBilling: BillingInfo | null = null;

  getEndpoint(): string {
    const proxyUrl = PROXY_CONFIG.BASE_URL;
    return `${proxyUrl}${PROXY_CONFIG.GROK_ENDPOINT}`;
  }

  getHeaders(requestBody: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const authHeaders = getSessionAuthHeaders(requestBody);
    if (authHeaders) {
      Object.assign(headers, authHeaders);
    }
    return headers;
  }

  async beforeRequest(): Promise<void> {
    await validateTokenMode();
  }

  onStreamChunk(parsed: any): void {
    if (parsed.billing) {
      this.lastBilling = parsed.billing as BillingInfo;
    }
  }

  getLastBilling(): BillingInfo | null {
    return this.lastBilling;
  }
}
