import { describe, expect, test } from 'vitest';
import { SlashbotKernel } from '../src/core/kernel/kernel.js';

describe('Kernel plugin failure isolation', () => {
  test('keeps operational state when one bundled plugin fails registration', async () => {
    const goodManifest = {
      id: 'good.plugin',
      name: 'Good Plugin',
      version: '1.0.0',
      main: 'bundled'
    };

    const badManifest = {
      id: 'bad.plugin',
      name: 'Bad Plugin',
      version: '1.0.0',
      main: 'bundled'
    };

    const kernel = await SlashbotKernel.create({
      workspaceRoot: process.cwd(),
      bundledPlugins: {
        good: () => ({
          manifest: goodManifest,
          setup: (context) => {
            context.registerGatewayMethod({
              id: 'good.echo',
              pluginId: 'good.plugin',
              description: 'echo',
              handler: async (params) => params
            });
          }
        }),
        bad: () => ({
          manifest: badManifest,
          setup: () => {
            throw new Error('simulated plugin setup failure');
          }
        })
      },
      bundledDiscovered: [
        { manifest: goodManifest, pluginPath: 'bundled:good', source: 'bundled' },
        { manifest: badManifest, pluginPath: 'bundled:bad', source: 'bundled' }
      ]
    });

    const diagnostics = kernel.diagnosticsReport();
    expect(diagnostics.some((entry) => entry.pluginId === 'bad.plugin' && entry.status === 'failed')).toBe(true);
    expect(kernel.gatewayMethods.get('good.echo')).toBeDefined();
    expect(kernel.health().status).toBe('degraded');
  });

  test('fails fast when bundled plugins contain dependency cycles', async () => {
    const manifestA = {
      id: 'cycle.a',
      name: 'Cycle A',
      version: '1.0.0',
      main: 'bundled',
      dependencies: ['cycle.b'],
    };
    const manifestB = {
      id: 'cycle.b',
      name: 'Cycle B',
      version: '1.0.0',
      main: 'bundled',
      dependencies: ['cycle.a'],
    };

    await expect(SlashbotKernel.create({
      workspaceRoot: process.cwd(),
      bundledPlugins: {
        a: () => ({ manifest: manifestA, setup: () => {} }),
        b: () => ({ manifest: manifestB, setup: () => {} }),
      },
      bundledDiscovered: [
        { manifest: manifestA, pluginPath: 'bundled:a', source: 'bundled' },
        { manifest: manifestB, pluginPath: 'bundled:b', source: 'bundled' },
      ],
    })).rejects.toThrow('Plugin dependency cycle detected');
  });

  test('cycle detection message lists unresolved ids in sorted order', async () => {
    const manifestA = {
      id: 'zz-cycle.c',
      name: 'Cycle C',
      version: '1.0.0',
      main: 'bundled',
      dependencies: ['zz-cycle.a'],
    };
    const manifestB = {
      id: 'zz-cycle.a',
      name: 'Cycle A',
      version: '1.0.0',
      main: 'bundled',
      dependencies: ['zz-cycle.b'],
    };
    const manifestC = {
      id: 'zz-cycle.b',
      name: 'Cycle B',
      version: '1.0.0',
      main: 'bundled',
      dependencies: ['zz-cycle.c'],
    };

    await expect(SlashbotKernel.create({
      workspaceRoot: process.cwd(),
      bundledPlugins: {
        a: () => ({ manifest: manifestA, setup: () => {} }),
        b: () => ({ manifest: manifestB, setup: () => {} }),
        c: () => ({ manifest: manifestC, setup: () => {} }),
      },
      bundledDiscovered: [
        { manifest: manifestA, pluginPath: 'bundled:a', source: 'bundled' },
        { manifest: manifestB, pluginPath: 'bundled:b', source: 'bundled' },
        { manifest: manifestC, pluginPath: 'bundled:c', source: 'bundled' },
      ],
    })).rejects.toThrow('zz-cycle.a, zz-cycle.b, zz-cycle.c');
  });
});
