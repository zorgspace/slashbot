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
      const result = await shellExec({ args: ['sh', '-lc', 'printf ok-args'] });
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
});
