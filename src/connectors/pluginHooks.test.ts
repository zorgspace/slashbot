import { describe, expect, it } from 'vitest';
import { TYPES } from '../core/di/types';
import { createConnectorKernelHooks } from './pluginHooks';

function createContext(runtimeEntry?: any): any {
  const registry = runtimeEntry
    ? {
        get: (id: string) => (id === 'telegram' ? runtimeEntry : undefined),
      }
    : {
        get: () => undefined,
      };

  return {
    container: {
      get: (token: symbol) => {
        if (token === TYPES.ConnectorRegistry) {
          return registry;
        }
        throw new Error('Unknown token');
      },
    },
  };
}

describe('createConnectorKernelHooks', () => {
  it('adds connector sidebar item when connector runtime exists', () => {
    const hooks = createConnectorKernelHooks({
      connectorId: 'telegram',
      sidebarLabel: 'Telegram',
      sidebarOrder: 10,
      protectedAgentId: 'agent-protected',
    });
    const sidebarHook = hooks.find(h => h.event === 'sidebar:before');
    expect(sidebarHook).toBeDefined();

    const patch = sidebarHook!.handler(
      {
        sidebarData: {
          model: 'grok-3',
          provider: 'xai',
          availableModels: [],
          items: [{ id: 'core', label: 'Core', active: true, order: 1 }],
        },
      },
      createContext({
        isRunning: () => true,
        getStatus: () => ({ running: true }),
      }),
    ) as any;

    expect(Array.isArray(patch?.sidebarData?.items)).toBe(true);
    expect(patch.sidebarData.items.some((item: any) => item.id === 'telegram')).toBe(true);
    expect(patch.sidebarData.items[0].id).toBe('core');
    expect(patch.sidebarData.items[1].id).toBe('telegram');
  });

  it('locks the configured protected agent tab', () => {
    const hooks = createConnectorKernelHooks({
      connectorId: 'telegram',
      sidebarLabel: 'Telegram',
      sidebarOrder: 10,
      protectedAgentId: 'agent-protected',
    });
    const tabsHook = hooks.find(h => h.event === 'tabs:before');
    expect(tabsHook).toBeDefined();

    const patch = tabsHook!.handler(
      {
        tabs: [
          {
            id: 'agent-protected',
            label: 'Protected Agent',
            section: 'agents',
            editable: true,
            removable: true,
          },
          {
            id: 'agent-worker',
            label: 'Worker',
            section: 'agents',
            editable: true,
            removable: true,
          },
        ],
      },
      createContext(),
    ) as any;

    expect(Array.isArray(patch?.tabs)).toBe(true);
    expect(patch.tabs[0].removable).toBe(false);
    expect(patch.tabs[1].removable).toBe(true);
  });

  it('subscribes startup UI refresh only for matching connector events', () => {
    const hooks = createConnectorKernelHooks({
      connectorId: 'telegram',
      sidebarLabel: 'Telegram',
      sidebarOrder: 10,
    });
    const startupHook = hooks.find(h => h.event === 'startup:after-ui-ready');
    expect(startupHook).toBeDefined();

    const handlers: Record<string, ((event: any) => void)[]> = {};
    const refreshCalls: string[] = [];

    startupHook!.handler(
      {
        refreshLayout: () => refreshCalls.push('refresh'),
      },
      {
        ...createContext(),
        eventBus: {
          on: (type: string, handler: (event: any) => void) => {
            if (!handlers[type]) handlers[type] = [];
            handlers[type].push(handler);
            return () => {};
          },
        },
      } as any,
    );

    handlers['connector:connected']?.forEach(handler => handler({ source: 'discord' }));
    handlers['connector:connected']?.forEach(handler => handler({ source: 'telegram' }));
    handlers['connector:disconnected']?.forEach(handler => handler({ source: 'telegram' }));

    expect(refreshCalls.length).toBe(2);
  });
});
