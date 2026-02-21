import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { loadRuntimeConfig } from '../src/core/config/runtime-config.js';

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe('Runtime config merging', () => {
  test('plugins.paths extends across config layers with dedupe', async () => {
    const previousCwd = process.cwd();
    const workspaceRoot = mkdtempSync(join(tmpdir(), `slashbot-ws-${randomUUID()}-`));
    const isolatedCwd = mkdtempSync(join(tmpdir(), `slashbot-cwd-${randomUUID()}-`));
    const userConfigPath = join(tmpdir(), `slashbot-user-${randomUUID()}.json`);
    const workspaceConfigPath = join(workspaceRoot, '.slashbot', 'config.json');

    try {
      process.chdir(isolatedCwd);
      writeJson(userConfigPath, {
        plugins: {
          paths: ['custom/extensions', '.slashbot/extensions'],
        },
      });
      writeJson(workspaceConfigPath, {
        plugins: {
          paths: ['workspace/plugins', 'custom/extensions'],
        },
      });

      const config = await loadRuntimeConfig(workspaceRoot, { configPath: userConfigPath });
      expect(config.plugins.paths).toEqual([
        '.slashbot/extensions',
        'custom/extensions',
        'workspace/plugins',
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('non-path arrays still use override semantics', async () => {
    const previousCwd = process.cwd();
    const workspaceRoot = mkdtempSync(join(tmpdir(), `slashbot-ws-${randomUUID()}-`));
    const isolatedCwd = mkdtempSync(join(tmpdir(), `slashbot-cwd-${randomUUID()}-`));
    const userConfigPath = join(tmpdir(), `slashbot-user-${randomUUID()}.json`);
    const workspaceConfigPath = join(workspaceRoot, '.slashbot', 'config.json');

    try {
      process.chdir(isolatedCwd);
      writeJson(userConfigPath, {
        plugins: {
          allow: ['plugin.from.user'],
        },
      });
      writeJson(workspaceConfigPath, {
        plugins: {
          allow: ['plugin.from.workspace'],
        },
      });

      const config = await loadRuntimeConfig(workspaceRoot, { configPath: userConfigPath });
      expect(config.plugins.allow).toEqual(['plugin.from.workspace']);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
