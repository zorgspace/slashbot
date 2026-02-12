import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getLocalGatewayAuthFile } from '../config/constants';

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_TOKENS = 64;

interface PersistedGatewayAuthState {
  version: 1;
  pairingCodes: PairingCodeRecord[];
  tokens: GatewayTokenRecord[];
}

interface PairingCodeRecord {
  id: string;
  hash: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

interface GatewayTokenRecord {
  id: string;
  hash: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface GatewayPairingCode {
  code: string;
  label: string;
  expiresAt: string;
}

export interface GatewayAuthClient {
  id: string;
  label: string;
  tokenIssuedAt: string;
}

function normalizeLabel(label?: string): string {
  const value = String(label || '').trim();
  if (!value) return 'gateway-client';
  return value.slice(0, 80);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function generatePairingCode(): string {
  const raw = randomBytes(5).toString('hex').toUpperCase();
  return `SBPAIR-${raw}`;
}

function generateAccessToken(): string {
  const raw = randomBytes(24).toString('base64url');
  return `sbgw_${raw}`;
}

export class GatewayAuthManager {
  private readonly authFile: string;
  private state: PersistedGatewayAuthState = {
    version: 1,
    pairingCodes: [],
    tokens: [],
  };
  private loaded = false;

  constructor(options?: { workDir?: string; authFile?: string }) {
    this.authFile = options?.authFile || getLocalGatewayAuthFile(options?.workDir);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.authFile), { recursive: true });
    await writeFile(this.authFile, JSON.stringify(this.state, null, 2), 'utf8');
  }

  private pruneExpiredPairings(now: number = Date.now()): void {
    this.state.pairingCodes = this.state.pairingCodes.filter(record => {
      if (record.usedAt) return false;
      return Date.parse(record.expiresAt) > now;
    });
  }

  private pruneRevokedTokens(): void {
    const active = this.state.tokens.filter(token => !token.revokedAt);
    if (active.length <= MAX_ACTIVE_TOKENS) {
      this.state.tokens = active;
      return;
    }

    const sorted = [...active].sort(
      (a, b) => Date.parse(a.createdAt || '0') - Date.parse(b.createdAt || '0'),
    );
    this.state.tokens = sorted.slice(sorted.length - MAX_ACTIVE_TOKENS);
  }

  async load(): Promise<void> {
    this.loaded = true;
    try {
      const rawText = await readFile(this.authFile, 'utf8');
      const raw = JSON.parse(rawText) as Partial<PersistedGatewayAuthState>;
      const version = Number(raw?.version || 1) === 1 ? 1 : 1;
      this.state = {
        version,
        pairingCodes: Array.isArray(raw?.pairingCodes) ? raw!.pairingCodes : [],
        tokens: Array.isArray(raw?.tokens) ? raw!.tokens : [],
      };
      this.pruneExpiredPairings();
      this.pruneRevokedTokens();
      await this.save();
    } catch {
      this.state = {
        version: 1,
        pairingCodes: [],
        tokens: [],
      };
    }
  }

  async createPairingCode(
    label?: string,
    ttlMs: number = DEFAULT_PAIRING_TTL_MS,
  ): Promise<GatewayPairingCode> {
    await this.ensureLoaded();
    const now = Date.now();
    this.pruneExpiredPairings(now);
    const code = generatePairingCode();
    const normalizedLabel = normalizeLabel(label);
    const expiresAt = new Date(now + Math.max(30_000, ttlMs)).toISOString();
    this.state.pairingCodes.push({
      id: generateId('pair'),
      hash: sha(code),
      label: normalizedLabel,
      createdAt: nowIso(),
      expiresAt,
    });
    await this.save();
    return {
      code,
      label: normalizedLabel,
      expiresAt,
    };
  }

  private issueToken(label: string): { token: string; record: GatewayTokenRecord } {
    const token = generateAccessToken();
    const createdAt = nowIso();
    const record: GatewayTokenRecord = {
      id: generateId('client'),
      hash: sha(token),
      label: normalizeLabel(label),
      createdAt,
    };
    return { token, record };
  }

  async consumePairingCode(
    code: string,
    label?: string,
  ): Promise<{ token: string; client: GatewayAuthClient } | null> {
    await this.ensureLoaded();
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) return null;

    const now = Date.now();
    this.pruneExpiredPairings(now);
    const codeHash = sha(normalizedCode);
    const record = this.state.pairingCodes.find(candidate => safeEqualHex(candidate.hash, codeHash));
    if (!record) return null;
    if (record.usedAt) return null;
    if (Date.parse(record.expiresAt) <= now) return null;

    record.usedAt = nowIso();
    const issued = this.issueToken(label || record.label);
    this.state.tokens.push(issued.record);
    this.pruneRevokedTokens();
    await this.save();

    return {
      token: issued.token,
      client: {
        id: issued.record.id,
        label: issued.record.label,
        tokenIssuedAt: issued.record.createdAt,
      },
    };
  }

  async authenticate(token: string): Promise<GatewayAuthClient | null> {
    await this.ensureLoaded();
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    const tokenHash = sha(normalized);
    const record = this.state.tokens.find(candidate => safeEqualHex(candidate.hash, tokenHash));
    if (!record || record.revokedAt) {
      return null;
    }
    record.lastUsedAt = nowIso();
    await this.save();
    return {
      id: record.id,
      label: record.label,
      tokenIssuedAt: record.createdAt,
    };
  }

  async rotateToken(currentToken: string): Promise<{ token: string; client: GatewayAuthClient } | null> {
    await this.ensureLoaded();
    const normalized = String(currentToken || '').trim();
    if (!normalized) return null;
    const tokenHash = sha(normalized);
    const record = this.state.tokens.find(candidate => safeEqualHex(candidate.hash, tokenHash));
    if (!record || record.revokedAt) {
      return null;
    }
    record.revokedAt = nowIso();
    const issued = this.issueToken(record.label);
    this.state.tokens.push(issued.record);
    this.pruneRevokedTokens();
    await this.save();
    return {
      token: issued.token,
      client: {
        id: issued.record.id,
        label: issued.record.label,
        tokenIssuedAt: issued.record.createdAt,
      },
    };
  }

  async revokeClient(clientId: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = String(clientId || '').trim();
    if (!normalized) return false;
    const record = this.state.tokens.find(item => item.id === normalized && !item.revokedAt);
    if (!record) return false;
    record.revokedAt = nowIso();
    await this.save();
    return true;
  }

  async getSummary(): Promise<{
    activeTokens: number;
    pendingPairingCodes: number;
    latestPairingExpiry?: string;
  }> {
    await this.ensureLoaded();
    this.pruneExpiredPairings();
    const activeTokens = this.state.tokens.filter(token => !token.revokedAt).length;
    const pending = this.state.pairingCodes.filter(record => !record.usedAt);
    const latestPairingExpiry = pending
      .map(record => record.expiresAt)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    await this.save();
    return {
      activeTokens,
      pendingPairingCodes: pending.length,
      latestPairingExpiry,
    };
  }
}

export function createGatewayAuthManager(options?: {
  workDir?: string;
  authFile?: string;
}): GatewayAuthManager {
  return new GatewayAuthManager(options);
}
