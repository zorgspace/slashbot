import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSkillsPlugin } from '../src/plugins/skills/index.js';

interface TestHarness {
  tools: Map<string, { execute: (args: unknown, context?: unknown) => Promise<{ ok: boolean; output?: unknown }> }>;
  contexts: Map<string, { provide: () => Promise<string> | string }>;
}

function noopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function setupPlugin(workspaceRoot: string): Promise<TestHarness> {
  const plugin = createSkillsPlugin();
  const tools = new Map<string, { execute: (args: unknown, context?: unknown) => Promise<{ ok: boolean; output?: unknown }> }>();
  const contexts = new Map<string, { provide: () => Promise<string> | string }>();

  await plugin.setup({
    registerTool: (tool) => {
      tools.set(tool.id, { execute: tool.execute as never });
    },
    registerService: () => undefined,
    contributeContextProvider: (provider) => {
      contexts.set(provider.id, { provide: provider.provide });
    },
    contributeStatusIndicator: () => () => {},
    getService: <TService,>(serviceId: string) => {
      if (serviceId === 'kernel.workspaceRoot') return workspaceRoot as TService;
      return undefined;
    },
    registerCommand: () => undefined,
    registerHook: () => undefined,
    registerProvider: () => undefined,
    registerGatewayMethod: () => undefined,
    registerHttpRoute: () => undefined,
    registerChannel: () => undefined,
    contributePromptSection: () => undefined,
    dispatchHook: async (_domain, _event, payload) => ({
      initialPayload: payload,
      finalPayload: payload,
      failures: [],
    }),
    logger: noopLogger(),
  });

  return { tools, contexts };
}

describe('skills plugin', () => {
  test('loads bundled Slashbot skill when workspace does not override', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-bundled-'));
    try {
      const harness = await setupPlugin(workspace);
      const runTool = harness.tools.get('skill.run');
      expect(runTool).toBeDefined();

      const result = await runTool!.execute({ name: 'weather' });
      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('[SKILL: weather]');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('workspace skill overrides bundled skill of same name', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-override-'));
    try {
      const weatherPath = join(workspace, '.slashbot', 'skills', 'weather');
      await mkdir(weatherPath, { recursive: true });
      await writeFile(join(weatherPath, 'skill.md'), '# Workspace Weather\nUse local weather API.', 'utf8');

      const harness = await setupPlugin(workspace);
      const runTool = harness.tools.get('skill.run');
      const result = await runTool!.execute({ name: 'weather' });

      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('[SKILL: weather]');
      expect(String(result.output)).toContain('Workspace Weather');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('collects markdown rules recursively and supports uppercase SKILL.md', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-rules-'));
    try {
      const skillRoot = join(workspace, '.slashbot', 'skills', 'custom-rule-skill');
      const refs = join(skillRoot, 'references');
      await mkdir(refs, { recursive: true });
      await writeFile(join(skillRoot, 'SKILL.md'), '# Custom Skill\nMain instructions.', 'utf8');
      await writeFile(join(refs, 'usage.md'), 'Rule details.', 'utf8');

      const harness = await setupPlugin(workspace);
      const runTool = harness.tools.get('skill.run');
      const result = await runTool!.execute({ name: 'custom-rule-skill' });

      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('[AVAILABLE RULE FILES]');
      expect(String(result.output)).toContain('references/usage.md');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('announces bundled skills in prompt context provider', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-context-'));
    try {
      const harness = await setupPlugin(workspace);
      const provider = harness.contexts.get('skills.installed');
      expect(provider).toBeDefined();
      const contextText = await provider!.provide();

      expect(String(contextText)).toContain('Slashbot skills are available.');
      expect(String(contextText)).toContain('## Installed Skills');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('non-existent skill returns error', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-notfound-'));
    try {
      const harness = await setupPlugin(workspace);
      const runTool = harness.tools.get('skill.run');
      expect(runTool).toBeDefined();
      const result = await runTool!.execute({ name: 'nonexistent-skill-xyz-999' });
      expect(result.ok).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('skill.install tool is registered', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-install-'));
    try {
      const harness = await setupPlugin(workspace);
      expect(harness.tools.has('skill.install')).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('context provider returns content even with empty workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-emptyws-'));
    try {
      const harness = await setupPlugin(workspace);
      const provider = harness.contexts.get('skills.installed');
      const text = await provider!.provide();
      // Should still return something (at least bundled skills listing)
      expect(typeof text).toBe('string');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('empty skill name returns error', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-empty-'));
    try {
      const harness = await setupPlugin(workspace);
      const runTool = harness.tools.get('skill.run');
      const result = await runTool!.execute({ name: '' });
      expect(result.ok).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
