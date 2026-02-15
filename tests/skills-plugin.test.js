import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSkillsPlugin } from '../src/plugins/skills/index.js';
function noopLogger() {
    return {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
}
async function setupPlugin(workspaceRoot) {
    const plugin = createSkillsPlugin();
    const tools = new Map();
    const contexts = new Map();
    await plugin.setup({
        registerTool: (tool) => {
            tools.set(tool.id, { execute: tool.execute });
        },
        registerService: () => undefined,
        contributeContextProvider: (provider) => {
            contexts.set(provider.id, { provide: provider.provide });
        },
        getService: (serviceId) => {
            if (serviceId === 'kernel.workspaceRoot')
                return workspaceRoot;
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
            const result = await runTool.execute({ name: 'weather' });
            expect(result.ok).toBe(true);
            expect(String(result.output)).toContain('[SKILL: weather | source=bundled]');
        }
        finally {
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
            const result = await runTool.execute({ name: 'weather' });
            expect(result.ok).toBe(true);
            expect(String(result.output)).toContain('[SKILL: weather | source=workspace]');
            expect(String(result.output)).toContain('Workspace Weather');
        }
        finally {
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
            const result = await runTool.execute({ name: 'custom-rule-skill' });
            expect(result.ok).toBe(true);
            expect(String(result.output)).toContain('[AVAILABLE RULE FILES]');
            expect(String(result.output)).toContain('references/usage.md');
        }
        finally {
            await rm(workspace, { recursive: true, force: true });
        }
    });
    test('announces bundled skills in prompt context provider', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'slashbot-skills-context-'));
        try {
            const harness = await setupPlugin(workspace);
            const provider = harness.contexts.get('skills.installed');
            expect(provider).toBeDefined();
            const contextText = await provider.provide();
            expect(String(contextText)).toContain('Bundled Slashbot skills are available.');
            expect(String(contextText)).toContain('## Installed Skills');
        }
        finally {
            await rm(workspace, { recursive: true, force: true });
        }
    });
});
