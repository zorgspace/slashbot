import { describe, expect, test } from 'vitest';
import { sanitizeMessages } from '../src/core/agentic/context/message-sanitizer.js';
import type { AgentMessage } from '../src/core/agentic/llm/types.js';

describe('sanitizeMessages', () => {
  test('removes empty-content messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: '' },
      { role: 'assistant', content: 'reply' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('assistant');
  });

  test('keeps non-empty messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(3);
  });

  test('Google provider merges consecutive same-role messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply' },
    ];
    const result = sanitizeMessages(msgs, 'google');
    // Two user messages should be merged
    const userMsgs = result.filter(m => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect(String(userMsgs[0].content)).toContain('first');
    expect(String(userMsgs[0].content)).toContain('second');
  });

  test('non-Google does not merge consecutive same-role', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ];
    const result = sanitizeMessages(msgs, 'openai');
    expect(result).toHaveLength(2);
  });

  test('empty array returns empty', () => {
    expect(sanitizeMessages([])).toEqual([]);
  });

  test('array content with text parts preserved', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(1);
  });

  test('empty array content removed', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: [] as never },
      { role: 'assistant', content: 'reply' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  test('Google: system messages never merged with adjacent same-role', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'q' },
    ];
    const result = sanitizeMessages(msgs, 'google');
    const sysMsgs = result.filter(m => m.role === 'system');
    expect(sysMsgs).toHaveLength(2);
  });

  test('Google: merges consecutive assistant messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'part1' },
      { role: 'assistant', content: 'part2' },
    ];
    const result = sanitizeMessages(msgs, 'google');
    const assistants = result.filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(String(assistants[0].content)).toContain('part1');
    expect(String(assistants[0].content)).toContain('part2');
  });

  test('Google: correctly alternating is untouched', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const result = sanitizeMessages(msgs, 'google');
    expect(result).toHaveLength(4);
  });

  test('no providerId skips Google rules', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(2);
  });

  test('mixed empty and non-empty: only non-empty kept', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('ok');
  });
});
