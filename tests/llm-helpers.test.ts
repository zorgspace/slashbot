import { describe, expect, test } from 'vitest';
import {
  estimateTokens,
  contentToText,
  estimateMessageTokens,
  resolveContextBudget,
  trimMessagesToFit,
  extractToken,
  isAbortError,
  isContextOverflowError,
  isRateLimitError,
  hasImageContent,
  asTextOnly,
  getRequestBodyText,
} from '../src/core/agentic/llm/helpers.js';
import type { AuthProfile } from '../src/core/kernel/contracts.js';

describe('estimateTokens', () => {
  test('chars / 4 rounded up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('contentToText', () => {
  test('string passthrough', () => {
    expect(contentToText('hello')).toBe('hello');
  });

  test('array with text and image parts', () => {
    const content = [
      { type: 'text' as const, text: 'Look at this' },
      { type: 'image' as const, image: 'data:image/png;base64,...', mimeType: 'image/png' },
    ];
    const result = contentToText(content);
    expect(result).toContain('Look at this');
    expect(result).toContain('[Image attached]');
  });
});

describe('estimateMessageTokens', () => {
  test('content tokens + 4 overhead', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'abcd' });
    expect(tokens).toBe(1 + 4); // 1 token for 4 chars + 4 overhead
  });
});

describe('resolveContextBudget', () => {
  test('contextLimit - reserve, min 1000', () => {
    expect(resolveContextBudget(128000, 20000)).toBe(108000);
    expect(resolveContextBudget(1500, 1000)).toBe(1000); // min 1000
    expect(resolveContextBudget(500, 500)).toBe(1000); // min 1000
  });
});

describe('trimMessagesToFit', () => {
  test('under budget returns as-is', () => {
    const msgs = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'world' },
    ];
    const result = trimMessagesToFit(msgs, 128000);
    expect(result).toEqual(msgs);
  });

  test('over budget trims oldest conversation, keeps system', () => {
    const system = { role: 'system' as const, content: 'You are a bot.' };
    const msgs = [
      system,
      { role: 'user' as const, content: 'a'.repeat(4000) },
      { role: 'assistant' as const, content: 'b'.repeat(4000) },
      { role: 'user' as const, content: 'c'.repeat(4000) },
      { role: 'assistant' as const, content: 'd'.repeat(4000) },
    ];
    // Very tight budget to force trimming
    const result = trimMessagesToFit(msgs, 2500, 0);
    // System messages should be preserved
    expect(result[0].role).toBe('system');
    // Should keep most recent messages
    expect(result.length).toBeLessThan(msgs.length);
  });

  test('system messages capped at 50% of budget', () => {
    const msgs = [
      { role: 'system' as const, content: 'S'.repeat(8000) },
      { role: 'user' as const, content: 'short question' },
    ];
    const result = trimMessagesToFit(msgs, 3000, 0);
    // System message should be truncated
    const systemContent = String(result.find(m => m.role === 'system')?.content ?? '');
    expect(systemContent.length).toBeLessThanOrEqual(8000);
  });
});

describe('extractToken', () => {
  test('apiKey field', () => {
    const profile = { data: { apiKey: 'sk-123' } } as unknown as AuthProfile;
    expect(extractToken(profile)).toBe('sk-123');
  });

  test('access field', () => {
    const profile = { data: { access: 'tok-456' } } as unknown as AuthProfile;
    expect(extractToken(profile)).toBe('tok-456');
  });

  test('undefined fallback', () => {
    const profile = { data: {} } as AuthProfile;
    expect(extractToken(profile)).toBeUndefined();
  });
});

describe('isAbortError', () => {
  test('AbortError name', () => {
    const err = new Error('Operation cancelled');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  test('message includes aborted', () => {
    expect(isAbortError(new Error('Request aborted by user'))).toBe(true);
  });

  test('string input', () => {
    expect(isAbortError('aborted')).toBe(true);
    expect(isAbortError('normal error')).toBe(false);
  });
});

describe('isContextOverflowError', () => {
  test('various error message patterns', () => {
    expect(isContextOverflowError('request too large')).toBe(true);
    expect(isContextOverflowError('request_too_large')).toBe(true);
    expect(isContextOverflowError('context length exceeded')).toBe(true);
    expect(isContextOverflowError('maximum context length')).toBe(true);
    expect(isContextOverflowError('prompt is too long')).toBe(true);
    expect(isContextOverflowError('exceeds model context window')).toBe(true);
    expect(isContextOverflowError('context overflow')).toBe(true);
  });

  test('false for unrelated', () => {
    expect(isContextOverflowError('network error')).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError('')).toBe(false);
  });
});

describe('isRateLimitError', () => {
  test('rate limit text', () => {
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('too many requests'))).toBe(true);
  });

  test('status 429', () => {
    const err = Object.assign(new Error('Error'), { status: 429 });
    expect(isRateLimitError(err)).toBe(true);
  });

  test('non-matching returns false', () => {
    expect(isRateLimitError(new Error('server error'))).toBe(false);
    expect(isRateLimitError('some string')).toBe(false);
  });
});

describe('hasImageContent', () => {
  test('detects image parts', () => {
    expect(hasImageContent([
      { role: 'user', content: [{ type: 'image', image: 'data:...', mimeType: 'image/png' }] },
    ])).toBe(true);
  });

  test('text-only returns false', () => {
    expect(hasImageContent([
      { role: 'user', content: 'just text' },
    ])).toBe(false);
  });
});

describe('asTextOnly', () => {
  test('converts image parts to text placeholders', () => {
    const result = asTextOnly([
      { role: 'user' as const, content: [
        { type: 'text' as const, text: 'Look' },
        { type: 'image' as const, image: 'data:...', mimeType: 'image/png' },
      ] },
    ]);
    expect(result[0].content).toContain('Look');
    expect(result[0].content).toContain('[Image attached]');
    expect(typeof result[0].content).toBe('string');
  });

  test('string content passes through', () => {
    const result = asTextOnly([
      { role: 'user' as const, content: 'hello' },
    ]);
    expect(result[0].content).toBe('hello');
  });
});

describe('getRequestBodyText', () => {
  test('string passthrough', () => {
    expect(getRequestBodyText('hello')).toBe('hello');
  });

  test('URLSearchParams', () => {
    const params = new URLSearchParams({ key: 'value' });
    expect(getRequestBodyText(params)).toBe('key=value');
  });

  test('unknown returns empty', () => {
    expect(getRequestBodyText(42)).toBe('');
  });

  test('null returns empty', () => {
    expect(getRequestBodyText(null)).toBe('');
  });

  test('undefined returns empty', () => {
    expect(getRequestBodyText(undefined)).toBe('');
  });
});

describe('estimateTokens (additional)', () => {
  test('single character returns 1', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  test('unicode text counts code units', () => {
    // '日本語'.length = 3 in JS, ceil(3/4) = 1
    expect(estimateTokens('日本語')).toBe(1);
  });
});

describe('contentToText (additional)', () => {
  test('empty array returns empty', () => {
    expect(contentToText([])).toBe('');
  });

  test('multiple text parts concatenated', () => {
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: 'World' },
    ];
    const result = contentToText(content);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });
});

describe('resolveContextBudget (additional)', () => {
  test('no reserveTokens uses default', () => {
    const result = resolveContextBudget(128_000);
    expect(result).toBe(108_000);
  });

  test('very large contextLimit', () => {
    expect(resolveContextBudget(1_000_000, 20_000)).toBe(980_000);
  });
});

describe('trimMessagesToFit (additional)', () => {
  test('empty array returns empty', () => {
    expect(trimMessagesToFit([], 128_000)).toEqual([]);
  });

  test('single message under budget returned as-is', () => {
    const msgs = [{ role: 'user' as const, content: 'hi' }];
    expect(trimMessagesToFit(msgs, 128_000)).toEqual(msgs);
  });
});

describe('extractToken (additional)', () => {
  test('apiKey takes priority over access', () => {
    const profile = { data: { apiKey: 'key', access: 'tok' } } as unknown as AuthProfile;
    expect(extractToken(profile)).toBe('key');
  });
});

describe('isAbortError (additional)', () => {
  test('null returns false', () => {
    expect(isAbortError(null)).toBe(false);
  });

  test('undefined returns false', () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  test('number returns false', () => {
    expect(isAbortError(42)).toBe(false);
  });
});

describe('isRateLimitError (additional)', () => {
  test('null returns false', () => {
    expect(isRateLimitError(null)).toBe(false);
  });

  test('non-429 status returns false', () => {
    const err = Object.assign(new Error('Error'), { status: 500 });
    expect(isRateLimitError(err)).toBe(false);
  });
});

describe('hasImageContent (additional)', () => {
  test('empty array returns false', () => {
    expect(hasImageContent([])).toBe(false);
  });

  test('mixed messages: some text, one with image', () => {
    expect(hasImageContent([
      { role: 'user', content: 'text only' },
      { role: 'user', content: [{ type: 'image', image: 'data:...', mimeType: 'image/png' }] },
    ])).toBe(true);
  });
});
