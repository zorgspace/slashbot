import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { createWalletPlugin } from '../src/plugins/wallet/index.js';
import type { CommandDefinition, JsonValue, ToolDefinition } from '../src/core/kernel/contracts.js';

interface Harness {
  commands: Map<string, CommandDefinition>;
  tools: Map<string, ToolDefinition>;
}

function noopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function setupHarness(tempHome?: string): Promise<Harness> {
  const plugin = createWalletPlugin();
  const commands = new Map<string, CommandDefinition>();
  const tools = new Map<string, ToolDefinition>();
  const home = tempHome ?? process.env.HOME ?? '/tmp';

  await plugin.setup({
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
          home: (...segs: string[]) => join(home, '.slashbot', ...segs),
          workspace: (...segs: string[]) => join(home, ...segs),
        } as TService;
      }
      return undefined;
    },
    dispatchHook: async (_domain, _event, payload) => ({
      initialPayload: payload,
      finalPayload: payload,
      failures: [],
    }),
    logger: noopLogger(),
  });

  return { commands, tools };
}

async function runCommand(command: CommandDefinition, args: string[]) {
  let stdout = '';
  let stderr = '';

  const writableOut = new Writable({
    write(chunk, _enc, cb) {
      stdout += chunk.toString();
      cb();
    },
  });

  const writableErr = new Writable({
    write(chunk, _enc, cb) {
      stderr += chunk.toString();
      cb();
    },
  });

  const code = await command.execute(args, {
    cwd: process.cwd(),
    stdout: writableOut,
    stderr: writableErr,
    env: process.env,
    nonInteractive: true,
  });

  return { code, stdout, stderr };
}

describe('wallet plugin parity surface', () => {
  test('registers full command and tool surfaces', async () => {
    const harness = await setupHarness();

    const solana = harness.commands.get('solana');
    expect(solana).toBeDefined();
    expect(solana?.subcommands).toEqual([
      'create',
      'import',
      'export',
      'balance',
      'send',
      'redeem',
      'deposit',
      'pricing',
      'mode',
      'usage',
      'unlock',
      'lock',
      'status',
    ]);

    expect(harness.commands.has('wallet')).toBe(false);
    expect(harness.tools.has('wallet.status')).toBe(true);
    expect(harness.tools.has('wallet.send')).toBe(true);
    expect(harness.tools.has('wallet.redeem')).toBe(true);
  });

  test('token mode fails without a configured wallet', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-mode-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      expect(solana).toBeDefined();

      const result = await runCommand(solana!, ['mode', 'token']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No wallet configured');
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('status reports reference proxy default when no override exists', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-proxy-default-'));
    const originalHome = process.env.HOME;
    const originalSlashbotProxy = process.env.SLASHBOT_PROXY_URL;
    const originalProxyBase = process.env.PROXY_BASE_URL;
    delete process.env.SLASHBOT_PROXY_URL;
    delete process.env.PROXY_BASE_URL;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      expect(solana).toBeDefined();

      const result = await runCommand(solana!, ['status']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Proxy URL: https://getslashbot.com');
    } finally {
      process.env.HOME = originalHome;
      process.env.SLASHBOT_PROXY_URL = originalSlashbotProxy;
      process.env.PROXY_BASE_URL = originalProxyBase;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('creates wallet and exports seed phrase', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-create-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      expect(solana).toBeDefined();

      const created = await runCommand(solana!, ['create', 'password123']);
      expect(created.code).toBe(0);
      expect(created.stdout).toContain('Wallet created');

      const exported = await runCommand(solana!, ['export', 'seed', 'password123']);
      expect(exported.code).toBe(0);
      expect(exported.stdout).toContain('Seed phrase:');
      const wordCount = exported.stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .slice(1)
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      expect(wordCount === 12 || wordCount === 24).toBe(true);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('wallet.send tool fails cleanly when wallet is missing', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-tool-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const sendTool = harness.tools.get('wallet.send');
      expect(sendTool).toBeDefined();

      const result = await sendTool!.execute({
        token: 'sol',
        to: '11111111111111111111111111111111',
        amount: 0.1,
      } as JsonValue, {});

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('SEND_ERROR');
      expect(result.error?.message.toLowerCase()).toContain('no wallet configured');
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('wallet.status tool works without wallet', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-status-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const statusTool = harness.tools.get('wallet.status');
      expect(statusTool).toBeDefined();
      const result = await statusTool!.execute({} as JsonValue, {});
      expect(result.ok).toBe(true);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('wallet.redeem tool fails without wallet', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-redeem-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const redeemTool = harness.tools.get('wallet.redeem');
      expect(redeemTool).toBeDefined();
      const result = await redeemTool!.execute({ amount: 1 } as JsonValue, {});
      expect(result.ok).toBe(false);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('balance command fails gracefully without wallet', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-bal-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      const result = await runCommand(solana!, ['balance']);
      expect(result.code).toBe(1);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('export without create fails', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-noexport-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      const result = await runCommand(solana!, ['export', 'password123']);
      expect(result.code).toBe(1);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('lock command works even when not unlocked', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-lock-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      const result = await runCommand(solana!, ['lock']);
      expect(result.code).toBe(0);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('double create fails', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-wallet-dblcreate-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const harness = await setupHarness(tempHome);
      const solana = harness.commands.get('solana');
      await runCommand(solana!, ['create', 'pass123']);
      const second = await runCommand(solana!, ['create', 'pass456']);
      expect(second.code).toBe(1);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
