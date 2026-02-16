import { describe, expect, test } from 'vitest';
import { limitHistoryTurns } from '../src/core/agentic/context/history-limiter.js';
import type { AgentMessage } from '../src/core/agentic/llm/types.js';

describe('limitHistoryTurns', () => {
  test('returns all when under limit', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    const result = limitHistoryTurns(msgs, 5);
    expect(result).toEqual(msgs);
  });

  test('trims oldest user turns, keeps system messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old-q' },
      { role: 'assistant', content: 'old-a' },
      { role: 'user', content: 'new-q' },
      { role: 'assistant', content: 'new-a' },
    ];
    const result = limitHistoryTurns(msgs, 1);
    // Should keep system + last user turn and its assistant reply
    expect(result.find(m => m.content === 'sys')).toBeDefined();
    expect(result.find(m => m.content === 'new-q')).toBeDefined();
    expect(result.find(m => m.content === 'new-a')).toBeDefined();
    expect(result.find(m => m.content === 'old-q')).toBeUndefined();
  });

  test('keeps associated assistant messages with recent turns', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
    ];
    const result = limitHistoryTurns(msgs, 2);
    // Should keep last 2 user turns and associated assistants
    expect(result.find(m => m.content === 'q2')).toBeDefined();
    expect(result.find(m => m.content === 'a2')).toBeDefined();
    expect(result.find(m => m.content === 'q3')).toBeDefined();
    expect(result.find(m => m.content === 'a3')).toBeDefined();
    expect(result.find(m => m.content === 'q1')).toBeUndefined();
  });

  test('maxTurns=0 returns all messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    expect(limitHistoryTurns(msgs, 0)).toEqual(msgs);
  });

  test('negative maxTurns returns all messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    expect(limitHistoryTurns(msgs, -1)).toEqual(msgs);
  });

  test('empty message array returns empty', () => {
    expect(limitHistoryTurns([], 5)).toEqual([]);
  });

  test('only system messages are all preserved', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
    ];
    const result = limitHistoryTurns(msgs, 1);
    expect(result).toHaveLength(2);
  });

  test('only assistant messages (no user turns) all kept', () => {
    const msgs: AgentMessage[] = [
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
    ];
    const result = limitHistoryTurns(msgs, 1);
    expect(result).toHaveLength(2);
  });

  test('large maxTurns keeps all', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    expect(limitHistoryTurns(msgs, 100)).toEqual(msgs);
  });

  test('single user message with maxTurns=1', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'only' },
    ];
    const result = limitHistoryTurns(msgs, 1);
    expect(result.find(m => m.content === 'only')).toBeDefined();
    expect(result.find(m => m.content === 'sys')).toBeDefined();
  });
});
