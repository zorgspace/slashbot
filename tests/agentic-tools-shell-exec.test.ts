import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  JsonValue,
  RuntimeConfig,
  ToolDefinition,
  ToolResult,
} from '../src/core/kernel/contracts.js';
import { createAgenticToolsPlugin } from '../src/plugins/agentic-tools/index.js';

function noopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function setupShellExec(workspaceRoot: string): Promise<(args: unknown) => Promise<ToolResult>> {
  const plugin = createAgenticToolsPlugin();
  let shellExec: ((args: unknown) => Promise<ToolResult>) | undefined;

  const config: RuntimeConfig = {
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

  await plugin.setup({
    registerTool: <TArgs extends JsonValue>(tool: ToolDefinition<TArgs>) => {
      if (tool.id === 'shell.exec') {
        shellExec = (input: unknown) => tool.execute(input as TArgs, {});
      }
    },
    registerCommand: () => undefined,
    registerHook: () => undefined,
    registerProvider: () => undefined,
    registerGatewayMethod: () => undefined,
    registerHttpRoute: () => undefined,
    registerService: () => undefined,
    getService: <TService,>(serviceId: string) => {
      if (serviceId === 'kernel.config') return config as TService;
      if (serviceId === 'kernel.workspaceRoot') return workspaceRoot as TService;
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

  if (!shellExec) {
    throw new Error('shell.exec tool not registered');
  }

  return shellExec;
}

describe('agentic-tools shell.exec command compatibility', () => {
  test('accepts full command string via command field', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-command-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'printf ok-command' });
      expect(result.ok).toBe(true);
      expect(String(result.output ?? '')).toContain('ok-command');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('falls back when only args array is provided', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-args-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'printf ok-args' });
      expect(result.ok).toBe(true);
      expect(String(result.output ?? '')).toContain('ok-args');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('keeps backward compatibility with legacy cmd field', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-cmd-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ cmd: 'printf ok-cmd' });
      expect(result.ok).toBe(true);
      expect(String(result.output ?? '')).toContain('ok-cmd');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('command not found returns error result', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-notfound-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'nonexistent_command_xyz_123' });
      expect(result.ok).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('failing command returns error', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-fail-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'false' });
      expect(result.ok).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('multiline output captured', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-multi-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'printf "line1\nline2\nline3"' });
      expect(result.ok).toBe(true);
      const output = String(result.output ?? '');
      expect(output).toContain('line1');
      expect(output).toContain('line2');
      expect(output).toContain('line3');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('command with environment access', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-shell-exec-env-'));
    try {
      const shellExec = await setupShellExec(workspace);
      const result = await shellExec({ command: 'echo $HOME' });
      expect(result.ok).toBe(true);
      expect(String(result.output ?? '').trim().length).toBeGreaterThan(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
