import { describe, expect, test } from 'vitest';
import type {
  CommandDefinition,
  ProviderDefinition,
  RuntimeConfig,
} from '../src/core/kernel/contracts.js';
import { createProviderAuthPlugin } from '../src/plugins/provider-auth/index.js';

function noopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createCaptureStream(): { stream: NodeJS.WritableStream; read: () => string } {
  let buffer = '';
  return {
    stream: {
      write(chunk: unknown) {
        buffer += String(chunk);
        return true;
      },
    } as NodeJS.WritableStream,
    read: () => buffer,
  };
}

function makeProviders(): ProviderDefinition[] {
  return [
    {
      id: 'alpha',
      pluginId: 'test',
      displayName: 'Alpha',
      authHandlers: [],
      preferredAuthOrder: [],
      models: [
        { id: 'a1', displayName: 'Alpha One', contextWindow: 8_000 },
        { id: 'a2', displayName: 'Alpha Two', contextWindow: 32_000 },
      ],
    },
    {
      id: 'beta',
      pluginId: 'test',
      displayName: 'Beta',
      authHandlers: [],
      preferredAuthOrder: [],
      models: [
        { id: 'b1', displayName: 'Beta One', contextWindow: 16_000 },
      ],
    },
  ];
}

async function setupProviderAuthCommands(
  runtimeConfig: RuntimeConfig,
  providers: ProviderDefinition[],
): Promise<Map<string, CommandDefinition>> {
  const commands = new Map<string, CommandDefinition>();
  const plugin = createProviderAuthPlugin();

  await plugin.setup({
    registerTool: () => undefined,
    registerCommand: (command) => {
      commands.set(command.id, command);
    },
    registerHook: () => undefined,
    registerProvider: () => undefined,
    registerGatewayMethod: () => undefined,
    registerHttpRoute: () => undefined,
    registerService: () => undefined,
    getService: <TService,>(serviceId: string) => {
      if (serviceId === 'kernel.config') return runtimeConfig as TService;
      if (serviceId === 'kernel.events') {
        return ({ publish: () => undefined }) as TService;
      }
      if (serviceId === 'kernel.providers.registry') {
        return ({
          list: () => providers,
          get: (id: string) => providers.find((provider) => provider.id === id),
        }) as TService;
      }
      return undefined;
    },
    registerChannel: () => undefined,
    contributePromptSection: () => undefined,
    contributeContextProvider: () => undefined,
    contributeStatusIndicator: () => () => {},
    dispatchHook: async (_domain, _event, payload) => ({
      initialPayload: payload,
      finalPayload: payload,
      failures: [],
    }),
    logger: noopLogger(),
  });

  return commands;
}

describe('provider-auth commands formatting', () => {
  test('/providers renders provider summary table', async () => {
    const runtimeConfig: RuntimeConfig = {
      gateway: { host: '127.0.0.1', port: 7680, authToken: 'test' },
      plugins: { allow: [], deny: [], entries: [], paths: [] },
      providers: {
        active: { providerId: 'alpha', modelId: 'a2' },
      },
      hooks: { defaultTimeoutMs: 2_000 },
      commandSafety: {
        defaultTimeoutMs: 10_000,
        riskyCommands: ['rm', 'sudo', 'dd'],
        requireExplicitApproval: false,
      },
      logging: { level: 'error' },
      skills: { allowBundled: true, entries: {} },
    };
    const commands = await setupProviderAuthCommands(runtimeConfig, makeProviders());
    const providersCommand = commands.get('providers');
    if (!providersCommand) throw new Error('/providers not registered');

    const stdout = createCaptureStream();
    const stderr = createCaptureStream();
    const exitCode = await providersCommand.execute([], {
      cwd: process.cwd(),
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: process.env,
      nonInteractive: true,
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    expect(stdout.read()).toContain('Providers');
    expect(stdout.read()).toContain('alpha');
    expect(stdout.read()).toContain('Alpha Two');
    expect(stdout.read()).toContain('Active: alpha (a2)');
  });

  test('/model select without picker prints available models', async () => {
    const runtimeConfig: RuntimeConfig = {
      gateway: { host: '127.0.0.1', port: 7680, authToken: 'test' },
      plugins: { allow: [], deny: [], entries: [], paths: [] },
      providers: {
        active: { providerId: 'alpha', modelId: 'a2' },
      },
      hooks: { defaultTimeoutMs: 2_000 },
      commandSafety: {
        defaultTimeoutMs: 10_000,
        riskyCommands: ['rm', 'sudo', 'dd'],
        requireExplicitApproval: false,
      },
      logging: { level: 'error' },
      skills: { allowBundled: true, entries: {} },
    };
    const commands = await setupProviderAuthCommands(runtimeConfig, makeProviders());
    const modelCommand = commands.get('model');
    if (!modelCommand) throw new Error('/model not registered');

    const stdout = createCaptureStream();
    const stderr = createCaptureStream();
    const exitCode = await modelCommand.execute(['select'], {
      cwd: process.cwd(),
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: process.env,
      nonInteractive: true,
    });

    expect(exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    expect(stderr.read()).toContain('Usage: /model select <model-id>');
    expect(stderr.read()).toContain('a1 — Alpha One');
    expect(stderr.read()).toContain('a2 — Alpha Two');
  });

  test('/model renders active model marker in alternatives list', async () => {
    const runtimeConfig: RuntimeConfig = {
      gateway: { host: '127.0.0.1', port: 7680, authToken: 'test' },
      plugins: { allow: [], deny: [], entries: [], paths: [] },
      providers: {
        active: { providerId: 'alpha', modelId: 'a2' },
      },
      hooks: { defaultTimeoutMs: 2_000 },
      commandSafety: {
        defaultTimeoutMs: 10_000,
        riskyCommands: ['rm', 'sudo', 'dd'],
        requireExplicitApproval: false,
      },
      logging: { level: 'error' },
      skills: { allowBundled: true, entries: {} },
    };
    const commands = await setupProviderAuthCommands(runtimeConfig, makeProviders());
    const modelCommand = commands.get('model');
    if (!modelCommand) throw new Error('/model not registered');

    const stdout = createCaptureStream();
    const stderr = createCaptureStream();
    const exitCode = await modelCommand.execute([], {
      cwd: process.cwd(),
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: process.env,
      nonInteractive: true,
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    expect(stdout.read()).toContain('Active: a2 (alpha)');
    expect(stdout.read()).toContain('a2 * — Alpha Two');
  });
});
