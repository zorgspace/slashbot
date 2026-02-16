import { describe, expect, test, vi } from 'vitest';
import {
  Registry,
  ToolRegistry,
  CommandRegistry,
  ProviderRegistry,
  ServiceRegistry,
  HttpRouteRegistry,
  StatusIndicatorRegistry,
  safeRegister,
} from '../src/core/kernel/registries.js';
import type { IndicatorStatus, StatusIndicatorContribution, ToolDefinition, StructuredLogger } from '../src/core/kernel/contracts.js';
import { noopLogger } from './helpers.js';

describe('Registry', () => {
  test('register + get + list', () => {
    const reg = new Registry<{ id: string; value: number }>('Test');
    reg.register({ id: 'a', value: 1 });
    reg.register({ id: 'b', value: 2 });

    expect(reg.get('a')).toEqual({ id: 'a', value: 1 });
    expect(reg.get('c')).toBeUndefined();
    expect(reg.list()).toHaveLength(2);
  });

  test('duplicate throws', () => {
    const reg = new Registry<{ id: string }>('Test');
    reg.register({ id: 'x' });
    expect(() => reg.register({ id: 'x' })).toThrow('already registered');
  });

  test('upsert overwrites without error', () => {
    const reg = new Registry<{ id: string; value: number }>('Test');
    reg.register({ id: 'x', value: 1 });
    reg.upsert({ id: 'x', value: 2 });
    expect(reg.get('x')).toEqual({ id: 'x', value: 2 });
  });
});

describe('ToolRegistry', () => {
  test('inherits Registry behavior', () => {
    const reg = new ToolRegistry();
    const tool = { id: 'test.tool', pluginId: 'p', description: 'desc', execute: async () => ({ ok: true }) } as ToolDefinition;
    reg.register(tool);
    expect(reg.get('test.tool')).toBeDefined();
    expect(reg.list()).toHaveLength(1);
  });
});

describe('CommandRegistry', () => {
  test('inherits Registry behavior', () => {
    const reg = new CommandRegistry();
    reg.register({ id: 'cmd', pluginId: 'p', description: 'desc', execute: async () => 0 });
    expect(reg.get('cmd')).toBeDefined();
  });
});

describe('ProviderRegistry', () => {
  test('inherits Registry behavior', () => {
    const reg = new ProviderRegistry();
    reg.register({
      id: 'prov',
      pluginId: 'p',
      displayName: 'Test',
      models: [],
      authHandlers: [],
      preferredAuthOrder: [],
    });
    expect(reg.get('prov')).toBeDefined();
  });
});

describe('ServiceRegistry', () => {
  test('register and get with typed implementation', () => {
    const reg = new ServiceRegistry();
    reg.register({ id: 'svc', pluginId: 'p', description: 'desc', implementation: { value: 42 } });
    const impl = reg.get<{ value: number }>('svc');
    expect(impl).toEqual({ value: 42 });
  });

  test('list returns all services', () => {
    const reg = new ServiceRegistry();
    reg.register({ id: 'a', pluginId: 'p', description: 'd', implementation: 1 });
    reg.register({ id: 'b', pluginId: 'p', description: 'd', implementation: 2 });
    expect(reg.list()).toHaveLength(2);
  });

  test('duplicate service throws', () => {
    const reg = new ServiceRegistry();
    reg.register({ id: 's', pluginId: 'p', description: 'd', implementation: null });
    expect(() => reg.register({ id: 's', pluginId: 'p', description: 'd', implementation: null })).toThrow('already registered');
  });
});

describe('HttpRouteRegistry', () => {
  test('register and list', () => {
    const reg = new HttpRouteRegistry();
    reg.register({ method: 'GET', path: '/a', pluginId: 'p', description: 'd', handler: async () => {} });
    reg.register({ method: 'POST', path: '/a', pluginId: 'p', description: 'd', handler: async () => {} });
    expect(reg.list()).toHaveLength(2);
  });

  test('duplicate method+path throws', () => {
    const reg = new HttpRouteRegistry();
    reg.register({ method: 'GET', path: '/x', pluginId: 'p', description: 'd', handler: async () => {} });
    expect(() => reg.register({ method: 'GET', path: '/x', pluginId: 'p', description: 'd', handler: async () => {} })).toThrow('already registered');
  });
});

describe('StatusIndicatorRegistry', () => {
  function makeIndicator(id: string, opts?: Partial<StatusIndicatorContribution>): StatusIndicatorContribution {
    return {
      id,
      pluginId: 'p',
      label: id,
      kind: 'service',
      statusEvent: `${id}:status`,
      getInitialStatus: () => 'idle',
      ...opts,
    };
  }

  test('register and getStatus returns initial', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('ind1'));
    expect(reg.getStatus('ind1')).toBe('idle');
  });

  test('getStatus returns disconnected for unknown', () => {
    const reg = new StatusIndicatorRegistry();
    expect(reg.getStatus('unknown')).toBe('disconnected');
  });

  test('updateStatus triggers onChange listeners', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('ind1'));
    const fn = vi.fn();
    reg.onChange(fn);
    reg.updateStatus('ind1', 'connected');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reg.getStatus('ind1')).toBe('connected');
  });

  test('updateStatus with same value does not trigger', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('ind1'));
    const fn = vi.fn();
    reg.onChange(fn);
    reg.updateStatus('ind1', 'idle'); // same as initial
    expect(fn).not.toHaveBeenCalled();
  });

  test('unsubscribe stops listener', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('ind1'));
    const fn = vi.fn();
    const unsub = reg.onChange(fn);
    unsub();
    reg.updateStatus('ind1', 'connected');
    expect(fn).not.toHaveBeenCalled();
  });

  test('list sorted by priority', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('low', { priority: 200 }));
    reg.register(makeIndicator('high', { priority: 10 }));
    const list = reg.list();
    expect(list[0].id).toBe('high');
    expect(list[1].id).toBe('low');
  });

  test('findByConnectorName', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeIndicator('tg', { connectorName: 'telegram' }));
    expect(reg.findByConnectorName('telegram')?.id).toBe('tg');
    expect(reg.findByConnectorName('discord')).toBeUndefined();
  });
});

describe('safeRegister', () => {
  test('success case', () => {
    const result = safeRegister(noopLogger(), 'test', () => {});
    expect(result).toEqual({ ok: true });
  });

  test('failure case logs error', () => {
    const logger = { ...noopLogger(), error: vi.fn() };
    const result = safeRegister(logger, 'test', () => { throw new Error('boom'); });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('boom');
    expect(logger.error).toHaveBeenCalled();
  });

  test('non-Error throw returns ok false', () => {
    const result = safeRegister(noopLogger(), 'test', () => { throw 'string error'; });
    expect(result.ok).toBe(false);
  });
});

describe('Registry (additional)', () => {
  test('list returns a copy: mutation does not affect registry', () => {
    const reg = new Registry<{ id: string; value: number }>('Test');
    reg.register({ id: 'a', value: 1 });
    const list = reg.list();
    list.pop();
    expect(reg.list()).toHaveLength(1);
  });

  test('upsert on new item works same as register', () => {
    const reg = new Registry<{ id: string; value: number }>('Test');
    reg.upsert({ id: 'new', value: 42 });
    expect(reg.get('new')).toEqual({ id: 'new', value: 42 });
  });

  test('get returns undefined for empty string id', () => {
    const reg = new Registry<{ id: string }>('Test');
    expect(reg.get('')).toBeUndefined();
  });
});

describe('ToolRegistry (additional)', () => {
  test('duplicate tool id throws', () => {
    const reg = new ToolRegistry();
    const tool = { id: 't', pluginId: 'p', description: 'd', execute: async () => ({ ok: true }) } as ToolDefinition;
    reg.register(tool);
    expect(() => reg.register(tool)).toThrow('already registered');
  });
});

describe('HttpRouteRegistry (additional)', () => {
  test('same path different methods allowed', () => {
    const reg = new HttpRouteRegistry();
    reg.register({ method: 'GET', path: '/a', pluginId: 'p', description: 'd', handler: async () => {} });
    reg.register({ method: 'POST', path: '/a', pluginId: 'p', description: 'd', handler: async () => {} });
    expect(reg.list()).toHaveLength(2);
  });
});

describe('StatusIndicatorRegistry (additional)', () => {
  function makeInd(id: string, opts?: Partial<StatusIndicatorContribution>): StatusIndicatorContribution {
    return { id, pluginId: 'p', label: id, kind: 'service', statusEvent: `${id}:status`, getInitialStatus: () => 'idle', ...opts };
  }

  test('multiple onChange listeners all called', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeInd('x'));
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    reg.onChange(fn1);
    reg.onChange(fn2);
    reg.updateStatus('x', 'connected');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('register duplicate indicator throws', () => {
    const reg = new StatusIndicatorRegistry();
    reg.register(makeInd('dup'));
    expect(() => reg.register(makeInd('dup'))).toThrow('already registered');
  });
});

describe('ServiceRegistry (additional)', () => {
  test('get returns undefined for non-existent service', () => {
    const reg = new ServiceRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });
});
