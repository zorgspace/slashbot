import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { AuthProfileStore } from '../src/core/auth/profile-store.js';
import type { AuthProfile } from '../src/core/kernel/contracts.js';

function profile(providerId: string, profileId: string, apiKey: string): AuthProfile {
  return {
    providerId,
    profileId,
    label: `${providerId}-${profileId}`,
    method: 'api_key',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: { apiKey },
  };
}

describe('AuthProfileStore credentials.json', () => {
  test('stores profiles in ~/.slashbot/credentials.json-compatible path', async () => {
    const base = join(tmpdir(), `slashbot-creds-${randomUUID()}`);
    const store = new AuthProfileStore(base, join(base, 'cwd'), join(base, 'workspace'));
    const agentId = 'agent-main';

    await store.upsertProfile(agentId, profile('openai', 'default', 'home-key'));

    const credentialsPath = join(base, 'credentials.json');
    const raw = await fs.readFile(credentialsPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: number;
      agents?: Record<string, { profiles: AuthProfile[] }>;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.agents?.[agentId]?.profiles?.length).toBe(1);
    expect(parsed.agents?.[agentId]?.profiles?.[0]?.providerId).toBe('openai');
  });

  test('accepts credentials from cwd/workspace .slashbot/credentials.json as fallback', async () => {
    const base = join(tmpdir(), `slashbot-creds-${randomUUID()}`);
    const cwdPath = join(base, 'cwd');
    const workspacePath = join(base, 'workspace');
    await fs.mkdir(join(cwdPath, '.slashbot'), { recursive: true });
    await fs.mkdir(join(workspacePath, '.slashbot'), { recursive: true });

    const agentId = 'agent-main';
    const cwdProfile = profile('anthropic', 'cwd', 'cwd-key');
    const wsProfile = profile('google', 'workspace', 'ws-key');

    await fs.writeFile(
      join(cwdPath, '.slashbot', 'credentials.json'),
      `${JSON.stringify({ version: 1, agents: { [agentId]: { profiles: [cwdProfile] } } }, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      join(workspacePath, '.slashbot', 'credentials.json'),
      `${JSON.stringify({ version: 1, agents: { [agentId]: { profiles: [wsProfile] } } }, null, 2)}\n`,
      'utf8'
    );

    const store = new AuthProfileStore(base, cwdPath, workspacePath, true);
    const profiles = await store.listProfiles(agentId);

    expect(profiles.some((item) => item.providerId === 'anthropic' && item.profileId === 'cwd')).toBe(true);
    expect(profiles.some((item) => item.providerId === 'google' && item.profileId === 'workspace')).toBe(true);
  });

  test('prefers home credentials over cwd/workspace for same provider/profile key', async () => {
    const homeRoot = join(tmpdir(), `slashbot-creds-${randomUUID()}`);
    const cwdPath = join(homeRoot, 'cwd');
    const workspacePath = join(homeRoot, 'workspace');
    await fs.mkdir(join(cwdPath, '.slashbot'), { recursive: true });
    await fs.mkdir(join(workspacePath, '.slashbot'), { recursive: true });

    const agentId = 'agent-main';
    const sameKey = { providerId: 'xai', profileId: 'primary' };

    await fs.writeFile(
      join(homeRoot, 'credentials.json'),
      `${JSON.stringify({
        version: 1,
        agents: {
          [agentId]: { profiles: [profile(sameKey.providerId, sameKey.profileId, 'home-key')] },
        },
      }, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      join(cwdPath, '.slashbot', 'credentials.json'),
      `${JSON.stringify({
        version: 1,
        agents: {
          [agentId]: { profiles: [profile(sameKey.providerId, sameKey.profileId, 'cwd-key')] },
        },
      }, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      join(workspacePath, '.slashbot', 'credentials.json'),
      `${JSON.stringify({
        version: 1,
        agents: {
          [agentId]: { profiles: [profile(sameKey.providerId, sameKey.profileId, 'ws-key')] },
        },
      }, null, 2)}\n`,
      'utf8'
    );

    const store = new AuthProfileStore(homeRoot, cwdPath, workspacePath, true);
    const profiles = await store.listProfiles(agentId, sameKey.providerId);
    const selected = profiles.find((entry) => entry.profileId === sameKey.profileId);

    expect(selected).toBeDefined();
    expect(String(selected?.data.apiKey ?? '')).toBe('home-key');
  });
});
