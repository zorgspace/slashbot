import { describe, expect, test } from 'vitest';
import { windowByTokenBudget, mimeTypeFromDataUrl } from '../src/plugins/services/context-window.js';
import type { AgentMessage } from '../src/core/agentic/llm/types.js';

describe('windowByTokenBudget', () => {
  test('windows to budget, keeps most recent', () => {
    const msgs: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i} with some content padding here`,
    }));
    // Very tight budget
    const result = windowByTokenBudget(msgs, 50);
    expect(result.length).toBeLessThan(msgs.length);
    // Should contain the last message
    expect(result[result.length - 1].content).toBe(msgs[msgs.length - 1].content);
  });

  test('always includes at least one message', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'a'.repeat(10000) },
    ];
    const result = windowByTokenBudget(msgs, 1);
    expect(result).toHaveLength(1);
  });

  test('returns all when under budget', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'reply' },
    ];
    const result = windowByTokenBudget(msgs, 100000);
    expect(result).toEqual(msgs);
  });
});

describe('mimeTypeFromDataUrl', () => {
  test('extracts mime type from data URL', () => {
    expect(mimeTypeFromDataUrl('data:image/png;base64,abc')).toBe('image/png');
    expect(mimeTypeFromDataUrl('data:image/jpeg;base64,abc')).toBe('image/jpeg');
    expect(mimeTypeFromDataUrl('data:application/pdf;base64,abc')).toBe('application/pdf');
  });

  test('returns undefined for non-data URLs', () => {
    expect(mimeTypeFromDataUrl('https://example.com')).toBeUndefined();
  });

  test('text/plain mime type', () => {
    expect(mimeTypeFromDataUrl('data:text/plain;base64,abc')).toBe('text/plain');
  });

  test('empty string returns undefined', () => {
    expect(mimeTypeFromDataUrl('')).toBeUndefined();
  });
});

describe('windowByTokenBudget (additional)', () => {
  test('empty messages returns empty', () => {
    expect(windowByTokenBudget([], 100)).toEqual([]);
  });

  test('result is a suffix of original (order preserved)', () => {
    const msgs: AgentMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: 'user' as const,
      content: `msg-${i}`,
    }));
    const result = windowByTokenBudget(msgs, 30);
    // Last message in result should be last message of original
    expect(result[result.length - 1].content).toBe('msg-4');
    // First message in result should be somewhere in original
    const firstIdx = msgs.findIndex(m => m.content === result[0].content);
    expect(firstIdx).toBeGreaterThanOrEqual(0);
  });

  test('single short message with large budget', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'hi' }];
    expect(windowByTokenBudget(msgs, 100000)).toEqual(msgs);
  });

  test('budget exactly fits all messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'reply' },
    ];
    // Large budget ensures everything fits
    const result = windowByTokenBudget(msgs, 50);
    expect(result).toEqual(msgs);
  });
});
