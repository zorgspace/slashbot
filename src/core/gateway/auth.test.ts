import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { createGatewayAuthManager } from './auth';

describe('GatewayAuthManager', () => {
  async function withTempAuthFile<T>(run: (authFile: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-gateway-auth-'));
    const authFile = path.join(dir, 'gateway-auth.json');
    try {
      return await run(authFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('creates pairing code and exchanges it for token', async () => {
    await withTempAuthFile(async authFile => {
      const manager = createGatewayAuthManager({ authFile });
      const pairing = await manager.createPairingCode('test-client');

      expect(pairing.code.startsWith('SBPAIR-')).toBe(true);

      const exchanged = await manager.consumePairingCode(pairing.code);
      expect(exchanged).not.toBeNull();
      expect(exchanged?.token.startsWith('sbgw_')).toBe(true);
      expect(exchanged?.client.label).toBe('test-client');

      const reused = await manager.consumePairingCode(pairing.code);
      expect(reused).toBeNull();

      const authClient = await manager.authenticate(exchanged!.token);
      expect(authClient?.id).toBe(exchanged?.client.id);
    });
  });

  it('rotates token and invalidates old one', async () => {
    await withTempAuthFile(async authFile => {
      const manager = createGatewayAuthManager({ authFile });
      const pairing = await manager.createPairingCode('rotate-client');
      const exchanged = await manager.consumePairingCode(pairing.code);
      expect(exchanged).not.toBeNull();

      const rotated = await manager.rotateToken(exchanged!.token);
      expect(rotated).not.toBeNull();
      expect(rotated?.token).not.toBe(exchanged?.token);

      const oldAuth = await manager.authenticate(exchanged!.token);
      expect(oldAuth).toBeNull();

      const newAuth = await manager.authenticate(rotated!.token);
      expect(newAuth?.id).toBe(rotated?.client.id);
    });
  });
});
