import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { discoverPlugins } from '../src/core/plugins/discovery.js';

function makePlugin(root: string, id: string): void {
  const pluginDir = join(root, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      main: 'index.js'
    })
  );
}

describe('Plugin discovery precedence', () => {
  test('prefers filesystem config path over bundled on duplicate ids', async () => {
    const workspace = join(tmpdir(), `slashbot-${randomUUID()}`);
    const configPath = join(workspace, 'extensions-config');
    mkdirSync(configPath, { recursive: true });
    makePlugin(configPath, 'dup.plugin');

    const result = await discoverPlugins(
      {
        allow: [],
        deny: [],
        entries: [],
        paths: ['extensions-config']
      },
      workspace,
      [
        {
          manifest: {
            id: 'dup.plugin',
            name: 'dup',
            version: '1.0.0',
            main: 'bundled'
          },
          pluginPath: 'bundled:dup',
          source: 'bundled'
        }
      ]
    );

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.source).toBe('config');
  });

  test('throws when allow/deny/entries reference unknown plugin ids', async () => {
    const workspace = join(tmpdir(), `slashbot-${randomUUID()}`);
    mkdirSync(workspace, { recursive: true });

    await expect(
      discoverPlugins(
        {
          allow: ['unknown.plugin'],
          deny: [],
          entries: [],
          paths: []
        },
        workspace,
        []
      )
    ).rejects.toThrowError('Unknown plugin id');
  });

  test('emits discovery diagnostics for invalid manifest JSON', async () => {
    const workspace = join(tmpdir(), `slashbot-${randomUUID()}`);
    const configPath = join(workspace, 'extensions-config');
    mkdirSync(join(configPath, 'broken.plugin'), { recursive: true });
    writeFileSync(join(configPath, 'broken.plugin', 'manifest.json'), '{ invalid json');

    const result = await discoverPlugins(
      {
        allow: [],
        deny: [],
        entries: [],
        paths: ['extensions-config']
      },
      workspace,
      []
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.diagnostics.some((item) =>
      item.pluginId === 'broken.plugin' &&
      item.status === 'failed' &&
      typeof item.reason === 'string' &&
      item.reason.includes('Invalid manifest JSON')
    )).toBe(true);
  });

  test('emits discovery diagnostics for invalid manifest schema', async () => {
    const workspace = join(tmpdir(), `slashbot-${randomUUID()}`);
    const configPath = join(workspace, 'extensions-config');
    mkdirSync(join(configPath, 'schema.plugin'), { recursive: true });
    writeFileSync(
      join(configPath, 'schema.plugin', 'manifest.json'),
      JSON.stringify({
        name: 'Schema Plugin',
        version: '1.0.0',
        main: 'index.js'
      })
    );

    const result = await discoverPlugins(
      {
        allow: [],
        deny: [],
        entries: [],
        paths: ['extensions-config']
      },
      workspace,
      []
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.diagnostics.some((item) =>
      item.pluginId === 'schema.plugin' &&
      item.status === 'failed' &&
      typeof item.reason === 'string' &&
      item.reason.includes('Invalid manifest schema')
    )).toBe(true);
  });

  test('emits discovery diagnostics for unreadable manifest paths', async () => {
    const workspace = join(tmpdir(), `slashbot-${randomUUID()}`);
    const configPath = join(workspace, 'extensions-config');
    mkdirSync(join(configPath, 'io.plugin'), { recursive: true });
    // Create a directory named manifest.json so readFile fails (EISDIR)
    mkdirSync(join(configPath, 'io.plugin', 'manifest.json'), { recursive: true });

    const result = await discoverPlugins(
      {
        allow: [],
        deny: [],
        entries: [],
        paths: ['extensions-config']
      },
      workspace,
      []
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.diagnostics.some((item) =>
      item.pluginId === 'io.plugin' &&
      item.status === 'failed' &&
      typeof item.reason === 'string' &&
      item.reason.includes('Failed to read manifest')
    )).toBe(true);
  });
});
