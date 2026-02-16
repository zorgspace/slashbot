import { describe, expect, test, vi } from 'vitest';
import { EventBus } from '../src/core/kernel/event-bus.js';
import type { EventEnvelope } from '../src/core/kernel/event-bus.js';

describe('EventBus', () => {
  test('publish + subscribe delivers envelope with type, payload, and at', () => {
    const bus = new EventBus();
    const received: EventEnvelope[] = [];
    bus.subscribe('test:event', (env) => received.push(env));
    bus.publish('test:event', { key: 'value' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('test:event');
    expect(received[0].payload).toEqual({ key: 'value' });
    expect(received[0].at).toBeDefined();
  });

  test('subscribe returns unsubscribe function', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.subscribe('test:event', fn);
    bus.publish('test:event', { a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    bus.publish('test:event', { a: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('subscribeAll receives all event types', () => {
    const bus = new EventBus();
    const received: EventEnvelope[] = [];
    bus.subscribeAll((env) => received.push(env));

    bus.publish('event:a', { x: 1 });
    bus.publish('event:b', { y: 2 });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe('event:a');
    expect(received[1].type).toBe('event:b');
  });

  test('multiple subscribers on same event', () => {
    const bus = new EventBus();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.subscribe('test:event', fn1);
    bus.subscribe('test:event', fn2);
    bus.publish('test:event', { data: true });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('publish with no subscribers does not throw', () => {
    const bus = new EventBus();
    expect(() => bus.publish('no:listeners', { x: 1 })).not.toThrow();
  });

  test('subscribeAll unsubscribe stops receiving', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.subscribeAll(fn);
    bus.publish('a', { x: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    bus.publish('b', { x: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('envelope.at is a valid ISO date string', () => {
    const bus = new EventBus();
    const received: EventEnvelope[] = [];
    bus.subscribe('t', (env) => received.push(env));
    bus.publish('t', { k: 'v' });
    expect(new Date(received[0].at).toISOString()).toBe(received[0].at);
  });

  test('subscriber receives only its subscribed type', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.subscribe('type:a', fn);
    bus.publish('type:b', { x: 1 });
    expect(fn).not.toHaveBeenCalled();
    bus.publish('type:a', { x: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('subscribeAll + specific subscribe both receive', () => {
    const bus = new EventBus();
    const allFn = vi.fn();
    const specificFn = vi.fn();
    bus.subscribeAll(allFn);
    bus.subscribe('evt', specificFn);
    bus.publish('evt', { k: 1 });
    expect(allFn).toHaveBeenCalledTimes(1);
    expect(specificFn).toHaveBeenCalledTimes(1);
  });

  test('unsubscribe is idempotent', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.subscribe('t', fn);
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});
