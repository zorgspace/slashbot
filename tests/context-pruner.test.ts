import { describe, expect, test } from 'vitest';
import { pruneContextMessages } from '../src/core/agentic/context/context-pruner.js';
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

describe('pruneContextMessages', () => {
  test('under soft threshold: no pruning', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    const result = pruneContextMessages(msgs, makeConfig());
    expect(result.pruned).toBe(false);
    expect(result.messages).toEqual(msgs);
  });

  test('soft trim: large tool results get head+tail', () => {
    const largeToolResult = '{' + 'x'.repeat(4000) + '}';
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: largeToolResult },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'mid reply' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'recent reply' },
    ];
    // budget = max(1000, 2000) = 2000; ~4002/4=1001 tokens for tool result
    // total ~1020; ratio ~0.51 => above soft(0.5) but below hard(0.95)
    const config = makeConfig({
      contextLimit: 2000,
      reserveTokens: 0,
      softTrimThreshold: 0.5,
      hardClearThreshold: 0.95,
      softTrimMinChars: 500,
      softTrimKeepChars: 100,
      protectedRecentMessages: 1,
    });
    const result = pruneContextMessages(msgs, config);
    expect(result.pruned).toBe(true);
    const trimmedMsg = result.messages.find(m => String(m.content).includes('trimmed'));
    expect(trimmedMsg).toBeDefined();
  });

  test('hard clear: old tool results replaced with placeholder', () => {
    const largeToolResult = '{' + 'x'.repeat(8000) + '}';
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: largeToolResult },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'recent reply' },
    ];
    const config = makeConfig({
      contextLimit: 500,
      reserveTokens: 0,
      softTrimThreshold: 0.3,
      hardClearThreshold: 0.5,
      protectedRecentMessages: 1,
    });
    const result = pruneContextMessages(msgs, config);
    expect(result.pruned).toBe(true);
    const clearedMsg = result.messages.find(m => String(m.content).includes('cleared to save context'));
    expect(clearedMsg).toBeDefined();
  });

  test('protected recent messages are never pruned', () => {
    const largeResult = '{' + 'x'.repeat(5000) + '}';
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: largeResult },
      { role: 'assistant', content: 'recent-1' },
      { role: 'assistant', content: 'recent-2' },
    ];
    const config = makeConfig({
      contextLimit: 500,
      reserveTokens: 0,
      softTrimThreshold: 0.3,
      hardClearThreshold: 0.5,
      protectedRecentMessages: 2,
    });
    const result = pruneContextMessages(msgs, config);
    // Last 2 assistant messages should be untouched
    expect(result.messages.find(m => m.content === 'recent-1')).toBeDefined();
    expect(result.messages.find(m => m.content === 'recent-2')).toBeDefined();
  });
});

describe('pruneContextMessages (additional)', () => {
  test('empty messages returns empty', () => {
    const result = pruneContextMessages([], makeConfig());
    expect(result.messages).toHaveLength(0);
    expect(result.pruned).toBe(false);
  });

  test('system messages never pruned even in hard clear', () => {
    const sysContent = 'Detailed system prompt.';
    const msgs: AgentMessage[] = [
      { role: 'system', content: sysContent },
      { role: 'assistant', content: '{' + 'x'.repeat(5000) + '}' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'recent' },
    ];
    const result = pruneContextMessages(msgs, makeConfig({ contextLimit: 500, reserveTokens: 0, softTrimThreshold: 0.3, hardClearThreshold: 0.5 }));
    expect(result.messages.find(m => m.role === 'system')!.content).toBe(sysContent);
  });

  test('user messages never soft-trimmed', () => {
    const userContent = 'y'.repeat(3000);
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: userContent },
      { role: 'assistant', content: '{' + 'x'.repeat(3000) + '}' },
      { role: 'user', content: 'follow-up' },
      { role: 'assistant', content: 'recent' },
    ];
    const result = pruneContextMessages(msgs, makeConfig({ contextLimit: 2000, reserveTokens: 0, softTrimThreshold: 0.5, hardClearThreshold: 0.95 }));
    const userMsg = result.messages.find(m => m.role === 'user' && String(m.content) === userContent);
    expect(userMsg).toBeDefined();
  });

  test('multiple tool results: only large ones trimmed', () => {
    const small = '{"status": "ok"}';
    const large = '{' + 'x'.repeat(3000) + '}';
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: small },
      { role: 'assistant', content: large },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'recent' },
    ];
    const result = pruneContextMessages(msgs, makeConfig({ contextLimit: 2000, reserveTokens: 0, softTrimThreshold: 0.5, hardClearThreshold: 0.95 }));
    expect(result.messages.find(m => String(m.content) === small)).toBeDefined();
  });

  test('protectedRecentMessages=0 allows pruning all assistants', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: '{' + 'x'.repeat(5000) + '}' },
      { role: 'assistant', content: '[' + 'y'.repeat(5000) + ']' },
    ];
    const result = pruneContextMessages(msgs, makeConfig({ contextLimit: 500, reserveTokens: 0, softTrimThreshold: 0.3, hardClearThreshold: 0.5, protectedRecentMessages: 0 }));
    expect(result.pruned).toBe(true);
  });

  test('short assistant messages stay untouched in soft mode', () => {
    const normalReply = 'Normal conversational reply.';
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: normalReply },
      { role: 'assistant', content: '{' + 'x'.repeat(3000) + '}' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'recent' },
    ];
    const result = pruneContextMessages(msgs, makeConfig({ contextLimit: 2000, reserveTokens: 0, softTrimThreshold: 0.5, hardClearThreshold: 0.95 }));
    expect(result.messages.find(m => String(m.content) === normalReply)).toBeDefined();
  });
});
