import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CommandDefinition,
  JsonValue,
  PathResolver,
  PluginRegistrationContext,
  RuntimeConfig,
  StructuredLogger,
  ToolDefinition,
} from '../src/core/kernel/contracts.js';

export function noopLogger(): StructuredLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

export function defaultRuntimeConfig(): RuntimeConfig {
  return {
    gateway: { host: '127.0.0.1', port: 7680, authToken: 'test' },
    plugins: { allow: [], deny: [], entries: [], paths: [] },
    providers: {},
    hooks: { defaultTimeoutMs: 2_000 },
    commandSafety: {
      defaultTimeoutMs: 10_000,
      riskyCommands: ['rm', 'sudo', 'dd'],
      requireExplicitApproval: false,
    },
    logging: { level: 'error' },
  };
}

export interface MockSetupResult {
  tools: Map<string, ToolDefinition>;
  commands: Map<string, CommandDefinition>;
  context: PluginRegistrationContext;
}

export function createMockSetupContext(overrides?: {
  tempHome?: string;
  workspaceRoot?: string;
  config?: RuntimeConfig;
}): MockSetupResult {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, CommandDefinition>();
  const tempHome = overrides?.tempHome ?? '/tmp/slashbot-test';

  const context: PluginRegistrationContext = {
    registerTool: (tool) => {
      tools.set(tool.id, tool as ToolDefinition);
    },
    registerCommand: (command) => {
      commands.set(command.id, command);
    },
    registerService: () => undefined,
    registerHook: () => undefined,
    registerProvider: () => undefined,
    registerGatewayMethod: () => undefined,
    registerHttpRoute: () => undefined,
    registerChannel: () => undefined,
    contributePromptSection: () => undefined,
    contributeContextProvider: () => undefined,
    contributeStatusIndicator: () => (() => {}) as never,
    getService: <TService,>(serviceId: string) => {
      if (serviceId === 'kernel.paths') {
        return {
          home: (...segs: string[]) => join(tempHome, '.slashbot', ...segs),
          workspace: (...segs: string[]) => join(tempHome, ...segs),
        } as TService;
      }
      if (serviceId === 'kernel.workspaceRoot') {
        return (overrides?.workspaceRoot ?? tempHome) as TService;
      }
      if (serviceId === 'kernel.config') {
        return (overrides?.config ?? defaultRuntimeConfig()) as TService;
      }
      return undefined;
    },
    dispatchHook: async (_domain, _event, payload) => ({
      initialPayload: payload,
      finalPayload: payload,
      failures: [],
    }),
    logger: noopLogger(),
  };

  return { tools, commands, context };
}

export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'slashbot-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
