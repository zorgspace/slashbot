import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function setupFsTools(workspaceRoot: string): Promise<Record<string, (args: unknown) => Promise<ToolResult>>> {
  const plugin = createAgenticToolsPlugin();
  const tools: Record<string, (args: unknown) => Promise<ToolResult>> = {};

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
    skills: { allowBundled: true, entries: {} },
  };

  await plugin.setup({
    registerTool: <TArgs extends JsonValue>(tool: ToolDefinition<TArgs>) => {
      if (tool.id.startsWith('fs.')) {
        tools[tool.id] = (input: unknown) => tool.execute(input as TArgs, {});
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

  return tools;
}

describe('agentic-tools filesystem tool behavior', () => {
  test('fs.write and fs.read round-trip content', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-fs-roundtrip-'));
    try {
      const tools = await setupFsTools(workspace);
      const writeResult = await tools['fs.write']?.({ path: 'notes.txt', content: 'hello fs tool' });
      expect(writeResult?.ok).toBe(true);

      const readResult = await tools['fs.read']?.({ path: 'notes.txt' });
      expect(readResult?.ok).toBe(true);
      expect(readResult?.output).toBe('hello fs tool');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('fs.patch returns PATCH_FIND_NOT_FOUND for missing target text', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-fs-patch-missing-'));
    try {
      await writeFile(join(workspace, 'target.txt'), 'alpha beta gamma', 'utf8');
      const tools = await setupFsTools(workspace);
      const result = await tools['fs.patch']?.({
        path: 'target.txt',
        find: 'delta',
        replace: 'omega',
      });

      expect(result?.ok).toBe(false);
      expect(result?.error?.code).toBe('PATCH_FIND_NOT_FOUND');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('fs.patch returns PATCH_AMBIGUOUS for multiple matches', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-fs-patch-ambiguous-'));
    try {
      await writeFile(join(workspace, 'target.txt'), 'repeat repeat repeat', 'utf8');
      const tools = await setupFsTools(workspace);
      const result = await tools['fs.patch']?.({
        path: 'target.txt',
        find: 'repeat',
        replace: 'once',
      });

      expect(result?.ok).toBe(false);
      expect(result?.error?.code).toBe('PATCH_AMBIGUOUS');
      const unchanged = await readFile(join(workspace, 'target.txt'), 'utf8');
      expect(unchanged).toBe('repeat repeat repeat');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
