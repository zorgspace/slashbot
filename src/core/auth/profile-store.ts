import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { AuthProfile, JsonValue } from '../kernel/contracts.js';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

const AuthProfileSchema = z.object({
  profileId: z.string(),
  providerId: z.string(),
  label: z.string(),
  method: z.enum(['oauth_pkce', 'api_key', 'setup_token', 'claude_code_import']),
  createdAt: z.string(),
  updatedAt: z.string(),
  data: z.record(z.string(), JsonValueSchema),
});

const AuthProfileArraySchema = z.array(AuthProfileSchema);

const CredentialsFileSchema = z.object({
  version: z.number().optional(),
  agents: z.record(z.string(), z.object({
    profiles: AuthProfileArraySchema,
  })).optional(),
  profiles: AuthProfileArraySchema.optional(),
});

interface LegacyProfileFile {
  profiles: AuthProfile[];
}

interface CredentialsFile {
  version?: number;
  agents?: Record<string, { profiles: AuthProfile[] }>;
  profiles?: AuthProfile[];
}

const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 5_000;

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function profileKey(profile: AuthProfile): string {
  return `${profile.providerId}::${profile.profileId}`;
}

function asProfiles(value: unknown): AuthProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AuthProfile => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.providerId === 'string' && typeof candidate.profileId === 'string';
  });
}

function extractProfilesForAgent(parsed: CredentialsFile, agentId: string): AuthProfile[] {
  const scoped = parsed.agents?.[agentId];
  if (scoped && Array.isArray(scoped.profiles)) {
    return asProfiles(scoped.profiles);
  }

  // Backward compatibility for single-file layouts.
  return asProfiles(parsed.profiles);
}

async function readLegacyProfileFile(path: string): Promise<LegacyProfileFile> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as LegacyProfileFile;
    if (!parsed || !Array.isArray(parsed.profiles)) {
      throw new Error('Invalid legacy profile store format');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { profiles: [] };
    }
    throw error;
  }
}

async function readCredentialsProfiles(path: string, agentId: string): Promise<AuthProfile[]> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const result = CredentialsFileSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      return [];
    }
    return extractProfilesForAgent(result.data as CredentialsFile, agentId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    // Invalid external file should not break auth resolution.
    return [];
  }
}

async function readCredentialsFile(path: string): Promise<CredentialsFile> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return CredentialsFileSchema.parse(JSON.parse(raw)) as CredentialsFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, agents: {} };
    }
    throw error;
  }
}

async function writeCredentialsFile(path: string, content: CredentialsFile): Promise<void> {
  await ensureDir(dirname(path));
  await fs.writeFile(path, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      return async () => {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, LOCK_RETRY_MS));
    }
  }

  throw new Error(`Timed out waiting for auth profile lock: ${lockPath}`);
}

export class AuthProfileStore {
  private readonly userRootPath: string;
  private readonly cwdPath: string;
  private readonly workspaceRoot: string;
  private readonly includeExternalCredentialSources: boolean;

  constructor(
    rootPath = join(homedir(), '.slashbot'),
    cwdPath = process.cwd(),
    workspaceRoot = process.cwd(),
    includeExternalCredentialSources?: boolean
  ) {
    this.userRootPath = rootPath;
    this.cwdPath = cwdPath;
    this.workspaceRoot = workspaceRoot;
    this.includeExternalCredentialSources = includeExternalCredentialSources
      ?? (resolve(rootPath) === resolve(join(homedir(), '.slashbot')));
  }

  private credentialsPathForUserRoot(): string {
    return join(this.userRootPath, 'credentials.json');
  }

  private credentialsPathForCwd(): string {
    return resolve(this.cwdPath, '.slashbot', 'credentials.json');
  }

  private credentialsPathForWorkspace(): string {
    return resolve(this.workspaceRoot, '.slashbot', 'credentials.json');
  }

  pathForAgent(agentId: string): string {
    return join(this.userRootPath, 'agents', agentId, 'agent', 'auth-profiles.json');
  }

  private async listFromSources(agentId: string): Promise<AuthProfile[]> {
    const sources = new Set<string>();
    sources.add(this.credentialsPathForUserRoot());
    if (this.includeExternalCredentialSources) {
      sources.add(this.credentialsPathForCwd());
      sources.add(this.credentialsPathForWorkspace());
    }

    const merged = new Map<string, AuthProfile>();
    for (const sourcePath of sources) {
      const profiles = await readCredentialsProfiles(sourcePath, agentId);
      for (const profile of profiles) {
        const key = profileKey(profile);
        if (!merged.has(key)) {
          merged.set(key, profile);
        }
      }
    }

    // Backward compatibility: read legacy per-agent auth profile file last.
    for (const legacyProfile of (await readLegacyProfileFile(this.pathForAgent(agentId))).profiles) {
      const key = profileKey(legacyProfile);
      if (!merged.has(key)) {
        merged.set(key, legacyProfile);
      }
    }

    return [...merged.values()];
  }

  async listProfiles(agentId: string, providerId?: string): Promise<AuthProfile[]> {
    const profiles = await this.listFromSources(agentId);
    if (!providerId) {
      return profiles;
    }
    return profiles.filter((item) => item.providerId === providerId);
  }

  async upsertProfile(agentId: string, profile: AuthProfile): Promise<void> {
    const credentialsPath = this.credentialsPathForUserRoot();
    const credentials = await readCredentialsFile(credentialsPath);
    const agents = credentials.agents ?? {};
    const current = asProfiles(agents[agentId]?.profiles ?? []);

    const index = current.findIndex(
      (item) => item.providerId === profile.providerId && item.profileId === profile.profileId
    );

    if (index >= 0) {
      current[index] = {
        ...profile,
        updatedAt: nowIso(),
      };
    } else {
      current.push({
        ...profile,
        createdAt: profile.createdAt || nowIso(),
        updatedAt: nowIso(),
      });
    }

    credentials.version = 1;
    credentials.agents = {
      ...agents,
      [agentId]: { profiles: current },
    };

    await writeCredentialsFile(credentialsPath, credentials);
  }

  async withProfileLock<T>(agentId: string, providerId: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = join(this.userRootPath, 'agents', agentId, 'agent', `${providerId}.auth.lock`);
    await ensureDir(dirname(lockPath));

    const release = await acquireLock(lockPath);
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}
