import { describe, expect, test } from 'vitest';
import { prepareContext } from '../src/core/agentic/context/pipeline.js';
import type { AgentMessage } from '../src/core/agentic/llm/types.js';
import type { ContextPipelineConfig } from '../src/core/agentic/context/types.js';

function makeConfig(overrides?: Partial<ContextPipelineConfig>): ContextPipelineConfig {
  return {
    contextLimit: 128_000,
    reserveTokens: 20_000,
    toolResultMaxContextShare: 0.25,
    toolResultHardMax: 100_000,
    toolResultMinKeep: 500,
    softTrimThreshold: 0.7,
    hardClearThreshold: 0.9,
    softTrimMinChars: 500,
    softTrimKeepChars: 200,
    protectedRecentMessages: 2,
    maxHistoryTurns: 0,
    ...overrides,
  };
}

describe('prepareContext (integration)', () => {
  test('returns estimated tokens and pruned/trimmed flags', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    const result = prepareContext(msgs, makeConfig());
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.trimmed).toBe(false);
    expect(result.pruned).toBe(false);
    expect(result.messages).toHaveLength(3);
  });

  test('combines all 4 steps when needed', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      // Many turns to trigger history limiting
      ...Array.from({ length: 20 }, (_, i) => [
        { role: 'user' as const, content: `question ${i}` },
        { role: 'assistant' as const, content: `answer ${i}` },
      ]).flat(),
    ];
    const result = prepareContext(msgs, makeConfig({
      maxHistoryTurns: 3,
      contextLimit: 5000,
      reserveTokens: 1000,
    }));
    // Should have trimmed some messages
    expect(result.messages.length).toBeLessThan(msgs.length);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  test('empty messages array', () => {
    const result = prepareContext([], makeConfig());
    expect(result.messages).toHaveLength(0);
    expect(result.trimmed).toBe(false);
    expect(result.pruned).toBe(false);
  });

  test('single system message passes through unchanged', () => {
    const msgs: AgentMessage[] = [{ role: 'system', content: 'sys prompt' }];
    const result = prepareContext(msgs, makeConfig());
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('sys prompt');
  });

  test('maxHistoryTurns=0 preserves all messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 10 }, (_, i) => [
        { role: 'user' as const, content: `q${i}` },
        { role: 'assistant' as const, content: `a${i}` },
      ]).flat(),
    ];
    const result = prepareContext(msgs, makeConfig({ maxHistoryTurns: 0 }));
    expect(result.messages).toHaveLength(21);
  });

  test('Google provider merges consecutive same-role', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'part 1' },
      { role: 'assistant', content: 'part 2' },
      { role: 'user', content: 'next' },
    ];
    const result = prepareContext(msgs, makeConfig({ providerId: 'google' }));
    const assistantMsgs = result.messages.filter(m => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(String(assistantMsgs[0].content)).toContain('part 1');
  });

  test('very small contextLimit forces trimming', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 20 }, (_, i) => [
        { role: 'user' as const, content: `question ${i} ${'x'.repeat(500)}` },
        { role: 'assistant' as const, content: `answer ${i} ${'y'.repeat(500)}` },
      ]).flat(),
    ];
    // budget = max(1000, 1200-100) = 1100 tokens; messages ≈ 20*2*126 = ~5040 tokens
    const result = prepareContext(msgs, makeConfig({ contextLimit: 1200, reserveTokens: 100 }));
    expect(result.messages.length).toBeLessThan(msgs.length);
    expect(result.trimmed).toBe(true);
  });

  test('system + 1 user: no trimming', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ];
    const result = prepareContext(msgs, makeConfig());
    expect(result.messages).toHaveLength(2);
    expect(result.trimmed).toBe(false);
  });

  test('pruned flag true when tool results pruned', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'run tool' },
      { role: 'assistant', content: '{' + 'x'.repeat(8000) + '}' },
      { role: 'user', content: 'what?' },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: 'more' },
      { role: 'assistant', content: 'summary' },
    ];
    const result = prepareContext(msgs, makeConfig({
      contextLimit: 2000,
      reserveTokens: 0,
      softTrimThreshold: 0.3,
      hardClearThreshold: 0.5,
      protectedRecentMessages: 1,
    }));
    expect(result.pruned).toBe(true);
  });
});
