import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('emit and on', () => {
    it('emits event to subscriber', () => {
      const handler = vi.fn();
      eventBus.on('task:complete', handler);

      eventBus.emit({
        type: 'task:complete',
        taskId: '123',
        taskName: 'Test Task',
        output: 'Success',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        type: 'task:complete',
        taskId: '123',
        taskName: 'Test Task',
        output: 'Success',
      });
    });

    it('multiple subscribers receive event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('task:started', handler1);
      eventBus.on('task:started', handler2);

      eventBus.emit({
        type: 'task:started',
        taskId: '456',
        taskName: 'Another Task',
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops receiving events', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('task:error', handler);

      eventBus.emit({
        type: 'task:error',
        taskId: '789',
        taskName: 'Error Task',
        error: 'Something went wrong',
      });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.emit({
        type: 'task:error',
        taskId: '790',
        taskName: 'Another Error Task',
        error: 'Another error',
      });
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('only receives events of subscribed type', () => {
      const handler = vi.fn();
      eventBus.on('connector:connected', handler);

      eventBus.emit({ type: 'connector:disconnected', source: 'telegram' });
      expect(handler).not.toHaveBeenCalled();

      eventBus.emit({ type: 'connector:connected', source: 'telegram' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAny', () => {
    it('receives all event types', () => {
      const handler = vi.fn();
      eventBus.onAny(handler);

      eventBus.emit({ type: 'grok:initialized' });
      eventBus.emit({ type: 'prompt:redraw' });
      eventBus.emit({ type: 'connector:connected', source: 'discord' });

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('unsubscribe works for onAny', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.onAny(handler);

      eventBus.emit({ type: 'grok:initialized' });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.emit({ type: 'grok:disconnected' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('once', () => {
    it('fires only once', () => {
      const handler = vi.fn();
      eventBus.once('prompt:redraw', handler);

      eventBus.emit({ type: 'prompt:redraw' });
      eventBus.emit({ type: 'prompt:redraw' });
      eventBus.emit({ type: 'prompt:redraw' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('off', () => {
    it('removes all listeners for event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('grok:initialized', handler1);
      eventBus.on('grok:initialized', handler2);

      eventBus.off('grok:initialized');

      eventBus.emit({ type: 'grok:initialized' });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes all listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('grok:initialized', handler1);
      eventBus.on('prompt:redraw', handler2);

      eventBus.clear();

      eventBus.emit({ type: 'grok:initialized' });
      eventBus.emit({ type: 'prompt:redraw' });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('returns correct count', () => {
      expect(eventBus.listenerCount('task:complete')).toBe(0);

      eventBus.on('task:complete', () => {});
      expect(eventBus.listenerCount('task:complete')).toBe(1);

      eventBus.on('task:complete', () => {});
      expect(eventBus.listenerCount('task:complete')).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('emitting with no subscribers does not error', () => {
      expect(() => {
        eventBus.emit({ type: 'grok:initialized' });
      }).not.toThrow();
    });

    it('handles async handlers', async () => {
      const results: number[] = [];
      eventBus.on('task:complete', async event => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push(1);
      });

      eventBus.emit({
        type: 'task:complete',
        taskId: '1',
        taskName: 'Async Test',
        output: '',
      });

      // Handler is called but async, wait for it
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(results).toEqual([1]);
    });
  });

  describe('type safety', () => {
    it('connector events have source', () => {
      const handler = vi.fn();
      eventBus.on('connector:message', handler);

      eventBus.emit({
        type: 'connector:message',
        source: 'telegram',
        message: 'Hello',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'telegram',
          message: 'Hello',
        }),
      );
    });

    it('plan events have items', () => {
      const handler = vi.fn();
      eventBus.on('plan:update', handler);

      eventBus.emit({
        type: 'plan:update',
        items: [{ id: '1', content: 'Task 1', status: 'pending' }],
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: '1' })]),
        }),
      );
    });
  });
});
