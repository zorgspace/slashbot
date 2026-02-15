import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { JsonValue, RuntimeConfig, RuntimeFlags } from '../kernel/contracts.js';

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

const ConfigHookEntrySchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  timeoutMs: z.number().optional(),
}).strict();

const ConfigHookRuleSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(ConfigHookEntrySchema),
}).strict();

const ConfigHookMapSchema = z.record(z.string(), z.array(ConfigHookRuleSchema));

const RuntimeConfigSchema = z.object({
  gateway: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    authToken: z.string(),
  }).strict(),
  plugins: z.object({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
    entries: z.array(z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      config: JsonValueSchema.optional(),
    })),
    paths: z.array(z.string()),
  }).strict(),
  providers: z.object({
    active: z.object({
      providerId: z.string(),
      modelId: z.string(),
      apiKey: z.string().optional(),
    }).optional(),
    fallbackOrder: z.unknown().optional(),
  }).strict().transform(({ fallbackOrder, ...rest }) => rest),
  hooks: z.object({
    defaultTimeoutMs: z.number(),
    rules: ConfigHookMapSchema.optional(),
  }).strict(),
  commandSafety: z.object({
    defaultTimeoutMs: z.number(),
    riskyCommands: z.array(z.string()),
    requireExplicitApproval: z.boolean(),
  }).strict(),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
  }).strict(),
}).strict();

export interface ConfigSources {
  userConfigPath: string;
  cwdConfigPath: string;
  workspaceConfigPath: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  gateway: {
    host: '127.0.0.1',
    port: 7680,
    authToken: 'change-me'
  },
  plugins: {
    allow: [],
    deny: [],
    entries: [],
    paths: ['.slashbot/extensions']
  },
  providers: {},
  hooks: {
    defaultTimeoutMs: 2_000
  },
  commandSafety: {
    defaultTimeoutMs: 60_000,
    riskyCommands: ['rm', 'sudo', 'dd'],
    requireExplicitApproval: true
  },
  logging: {
    level: 'info'
  }
};

function deepMerge<T extends Record<string, unknown>>(base: T, override?: Partial<T>): T {
  if (!override) {
    return structuredClone(base);
  }

  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const baseValue = output[key];

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      output[key] = deepMerge(baseValue as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    output[key] = value;
  }

  return output as T;
}

async function readOptionalJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Config root must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function resolveConfigSources(workspaceRoot: string, flags: RuntimeFlags): ConfigSources {
  return {
    userConfigPath: flags.configPath ?? join(homedir(), '.slashbot', 'config.json'),
    cwdConfigPath: resolve(process.cwd(), '.slashbot', 'config.json'),
    workspaceConfigPath: resolve(workspaceRoot, '.slashbot', 'config.json')
  };
}

function applyRuntimeFlags(config: RuntimeConfig, flags: RuntimeFlags): RuntimeConfig {
  const next = structuredClone(config);

  if (flags.gatewayToken) {
    next.gateway.authToken = flags.gatewayToken;
  }

  if (flags.nonInteractive !== undefined) {
    // Non-interactive runtime behavior is consumed by CLI; keep here for future pipeline hooks.
  }

  return next;
}

export async function saveRuntimeConfig(config: RuntimeConfig, configPath?: string): Promise<void> {
  const filePath = configPath ?? join(homedir(), '.slashbot', 'config.json');
  await fs.mkdir(join(homedir(), '.slashbot'), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function loadRuntimeConfig(workspaceRoot: string, flags: RuntimeFlags = {}): Promise<RuntimeConfig> {
  const sources = resolveConfigSources(workspaceRoot, flags);

  // Load order: defaults → ~/.slashbot/ → ./.slashbot/ (cwd) → workspace .slashbot/
  const userConfig = await readOptionalJson(sources.userConfigPath);
  const cwdConfig = sources.cwdConfigPath !== sources.userConfigPath && sources.cwdConfigPath !== sources.workspaceConfigPath
    ? await readOptionalJson(sources.cwdConfigPath)
    : undefined;
  const workspaceConfig = sources.workspaceConfigPath !== sources.userConfigPath
    ? await readOptionalJson(sources.workspaceConfigPath)
    : undefined;

  let merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig);
  merged = deepMerge(merged, cwdConfig);
  merged = deepMerge(merged, workspaceConfig);

  const validated = RuntimeConfigSchema.parse(merged) as unknown as RuntimeConfig;
  return applyRuntimeFlags(validated, flags);
}
