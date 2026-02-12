import { describe, expect, it } from 'vitest';

import {
  appendResponseStreamChunk,
  appendTabBufferAction,
  hasBufferedHistory,
  startResponseStream,
  type TabBufferAction,
} from './historyBuffer';

describe('historyBuffer', () => {
  it('coalesces response chunks into the latest response block', () => {
    let actions: TabBufferAction[] = [];
    actions = startResponseStream(actions);
    actions = appendResponseStreamChunk(actions, 'Hello');
    actions = appendResponseStreamChunk(actions, ' world');

    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: 'responseStream', content: 'Hello world' });
  });

  it('starts a new response block when start is called again', () => {
    let actions: TabBufferAction[] = [];
    actions = startResponseStream(actions);
    actions = appendResponseStreamChunk(actions, 'first');
    actions = startResponseStream(actions);
    actions = appendResponseStreamChunk(actions, 'second');

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: 'responseStream', content: 'first' });
    expect(actions[1]).toEqual({ type: 'responseStream', content: 'second' });
  });

  it('creates a response block when chunks arrive without an explicit start', () => {
    let actions: TabBufferAction[] = [];
    actions = appendResponseStreamChunk(actions, 'chunk');
    expect(actions).toEqual([{ type: 'responseStream', content: 'chunk' }]);
  });

  it('prunes old actions while keeping the latest ones', () => {
    let actions: TabBufferAction[] = [];
    actions = appendTabBufferAction(actions, { type: 'append', content: 'a' }, 2);
    actions = appendTabBufferAction(actions, { type: 'append', content: 'b' }, 2);
    actions = appendTabBufferAction(actions, { type: 'append', content: 'c' }, 2);

    expect(actions).toEqual([
      { type: 'append', content: 'b' },
      { type: 'append', content: 'c' },
    ]);
  });

  it('reports whether a tab has buffered history', () => {
    expect(hasBufferedHistory([])).toBe(false);
    expect(hasBufferedHistory([{ type: 'append', content: 'x' }])).toBe(true);
  });
});
