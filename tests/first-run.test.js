import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { isConfigurationMissing } from '../src/ui/first-run.js';
describe('first run configuration detection', () => {
    test('returns true when no user or workspace config exists', async () => {
        const root = join(tmpdir(), `slashbot-first-run-${randomUUID()}`);
        const userConfigPath = join(root, 'user', 'config.json');
        const workspaceRoot = join(root, 'workspace');
        await fs.mkdir(workspaceRoot, { recursive: true });
        const result = await isConfigurationMissing(workspaceRoot, { configPath: userConfigPath });
        expect(result).toBe(true);
    });
    test('returns false when workspace config exists', async () => {
        const root = join(tmpdir(), `slashbot-first-run-${randomUUID()}`);
        const userConfigPath = join(root, 'user', 'config.json');
        const workspaceRoot = join(root, 'workspace');
        const workspaceConfigPath = join(workspaceRoot, '.slashbot', 'config.json');
        await fs.mkdir(join(workspaceRoot, '.slashbot'), { recursive: true });
        await fs.writeFile(workspaceConfigPath, '{}\n', 'utf8');
        const result = await isConfigurationMissing(workspaceRoot, { configPath: userConfigPath });
        expect(result).toBe(false);
    });
    test('returns false when user config exists', async () => {
        const root = join(tmpdir(), `slashbot-first-run-${randomUUID()}`);
        const userConfigPath = join(root, 'user', 'config.json');
        const workspaceRoot = join(root, 'workspace');
        await fs.mkdir(join(root, 'user'), { recursive: true });
        await fs.mkdir(workspaceRoot, { recursive: true });
        await fs.writeFile(userConfigPath, '{}\n', 'utf8');
        const result = await isConfigurationMissing(workspaceRoot, { configPath: userConfigPath });
        expect(result).toBe(false);
    });
});
