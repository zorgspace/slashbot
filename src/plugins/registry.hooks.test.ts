import { describe, expect, it } from 'vitest';
import type { Plugin } from './types';
import { PluginRegistry } from './registry';

function createHookPlugin(options: {
  id: string;
  order: number;
  suffix: string;
}): Plugin {
  return {
    metadata: {
      id: options.id,
      name: options.id,
      version: '1.0.0',
      category: 'test',
      description: 'test',
    },
    async init(): Promise<void> {},
    getActionContributions: () => [],
    getPromptContributions: () => [],
    getKernelHooks: () => [
      {
        event: 'input:before',
        order: options.order,
        handler: payload => ({
          input: `${String(payload.input || '')}${options.suffix}`,
        }),
      },
    ],
  };
}

describe('PluginRegistry kernel hooks', () => {
  it('applies kernel hooks in order and merges payload patches', async () => {
    const registry = new PluginRegistry();
    registry.registerAll([
      createHookPlugin({ id: 'plugin.second', order: 20, suffix: '-two' }),
      createHookPlugin({ id: 'plugin.first', order: 10, suffix: '-one' }),
    ]);
    registry.setContext({ container: {} as any });
    await registry.initAll();

    const result = registry.applyKernelHooks('input:before', {
      input: 'base',
      source: 'cli',
    });

    expect(result.input).toBe('base-one-two');
    expect(result.source).toBe('cli');
  });

  it('returns original payload when no matching hooks exist', async () => {
    const registry = new PluginRegistry();
    registry.registerAll([createHookPlugin({ id: 'plugin.only', order: 10, suffix: '-x' })]);
    registry.setContext({ container: {} as any });
    await registry.initAll();

    const result = registry.applyKernelHooks('tabs:before', {
      activeTabId: 'agents',
    });

    expect(result.activeTabId).toBe('agents');
  });
});
