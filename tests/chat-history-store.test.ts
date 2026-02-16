import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { FileChatHistoryStore } from '../src/plugins/services/chat-history-store.js';

describe('FileChatHistoryStore', () => {
  test('append + get stores and retrieves messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('chat1', [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      const msgs = await store.get('chat1');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('hello');
      expect(msgs[1].content).toBe('hi');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('clear removes chat history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-clear-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('chat1', [{ role: 'user', content: 'msg' }]);
      await store.clear('chat1');
      const msgs = await store.get('chat1');
      expect(msgs).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('length returns count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-len-'));
    try {
      const store = new FileChatHistoryStore(dir);
      expect(await store.length('chat1')).toBe(0);
      await store.append('chat1', [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]);
      expect(await store.length('chat1')).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('persistence across instances (hydration from file)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-persist-'));
    try {
      const store1 = new FileChatHistoryStore(dir);
      await store1.append('chat1', [
        { role: 'user', content: 'persisted message' },
      ]);

      const store2 = new FileChatHistoryStore(dir);
      const msgs = await store2.get('chat1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('persisted message');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('MAX_HISTORY cap (40 entries)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-cap-'));
    try {
      const store = new FileChatHistoryStore(dir);
      const messages = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `msg-${i}`,
      }));
      await store.append('chat1', messages);
      const result = await store.get('chat1');
      expect(result).toHaveLength(40);
      // Should keep the most recent
      expect(result[result.length - 1].content).toBe('msg-49');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('appendRich + getRich: rich message support', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-rich-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.appendRich('chat1', [
        { role: 'user', content: 'use tool' },
        { role: 'assistant', content: 'ok', toolCalls: [{ id: 'tc1', name: 'test', args: {} }] },
        { role: 'tool', toolCallId: 'tc1', content: 'tool result' },
      ]);
      const rich = await store.getRich('chat1');
      expect(rich.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getSummary + setSummary: summary persistence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-summary-'));
    try {
      const store = new FileChatHistoryStore(dir);
      expect(await store.getSummary('chat1')).toBeUndefined();
      await store.setSummary('chat1', 'User discussed project setup');
      expect(await store.getSummary('chat1')).toBe('User discussed project setup');

      // Persistence across instances
      const store2 = new FileChatHistoryStore(dir);
      expect(await store2.getSummary('chat1')).toBe('User discussed project setup');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('multiple chat IDs are isolated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-iso-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('chat1', [{ role: 'user', content: 'msg-for-chat1' }]);
      await store.append('chat2', [{ role: 'user', content: 'msg-for-chat2' }]);
      const msgs1 = await store.get('chat1');
      const msgs2 = await store.get('chat2');
      expect(msgs1).toHaveLength(1);
      expect(msgs1[0].content).toBe('msg-for-chat1');
      expect(msgs2).toHaveLength(1);
      expect(msgs2[0].content).toBe('msg-for-chat2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('append incremental: multiple appends accumulate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-incr-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('c', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
      await store.append('c', [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }]);
      const msgs = await store.get('c');
      expect(msgs).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('clear one chat does not affect another', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-clear2-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('chat1', [{ role: 'user', content: 'keep' }]);
      await store.append('chat2', [{ role: 'user', content: 'remove' }]);
      await store.clear('chat2');
      expect(await store.get('chat1')).toHaveLength(1);
      expect(await store.get('chat2')).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('get on never-written chatId returns empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-noexist-'));
    try {
      const store = new FileChatHistoryStore(dir);
      expect(await store.get('never-written')).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('MAX_HISTORY cap with incremental appends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-cap2-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('c', Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, content: `b1-${i}` })));
      await store.append('c', Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `b2-${i}` })));
      const result = await store.get('c');
      expect(result).toHaveLength(40);
      expect(result[result.length - 1].content).toBe('b2-19');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('summary update overwrites previous', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-sumupd-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.setSummary('c', 'First');
      await store.setSummary('c', 'Second');
      expect(await store.getSummary('c')).toBe('Second');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rich history persistence across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-richp-'));
    try {
      const store1 = new FileChatHistoryStore(dir);
      await store1.appendRich('c', [
        { role: 'user', content: 'use tool' },
        { role: 'assistant', content: 'ok', toolCalls: [{ id: 'tc1', name: 'test', args: {} }] },
        { role: 'tool', toolCallId: 'tc1', content: 'result' },
      ]);
      const store2 = new FileChatHistoryStore(dir);
      const rich = await store2.getRich('c');
      expect(rich.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('length after clear returns 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-hist-lenclr-'));
    try {
      const store = new FileChatHistoryStore(dir);
      await store.append('c', [{ role: 'user', content: 'a' }]);
      await store.clear('c');
      expect(await store.length('c')).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
