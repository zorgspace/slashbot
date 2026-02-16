import { describe, expect, test } from 'vitest';
import { silentResult, userResult, dualResult } from '../src/core/kernel/contracts.js';

describe('contracts result helpers', () => {
  test('silentResult returns ok with forLlm and silent flag', () => {
    const result = silentResult('data for llm');
    expect(result).toEqual({ ok: true, forLlm: 'data for llm', silent: true });
  });

  test('userResult returns ok with forUser and forLlm ack', () => {
    const result = userResult('visible to user');
    expect(result).toEqual({ ok: true, forUser: 'visible to user', forLlm: 'OK' });
  });

  test('dualResult returns ok with separate forLlm and forUser', () => {
    const result = dualResult('llm payload', 'user payload');
    expect(result).toEqual({ ok: true, forLlm: 'llm payload', forUser: 'user payload' });
  });

  test('silentResult with object payload', () => {
    const result = silentResult({ data: [1, 2, 3] });
    expect(result.ok).toBe(true);
    expect(result.forLlm).toEqual({ data: [1, 2, 3] });
    expect(result.silent).toBe(true);
  });

  test('silentResult with null', () => {
    const result = silentResult(null);
    expect(result.ok).toBe(true);
    expect(result.forLlm).toBeNull();
  });

  test('userResult with complex object', () => {
    const result = userResult({ items: ['a', 'b'] });
    expect(result.ok).toBe(true);
    expect(result.forUser).toEqual({ items: ['a', 'b'] });
    expect(result.forLlm).toBe('OK');
  });

  test('dualResult with null forLlm', () => {
    const result = dualResult(null, 'user sees this');
    expect(result.ok).toBe(true);
    expect(result.forLlm).toBeNull();
    expect(result.forUser).toBe('user sees this');
  });

  test('all helpers return ok: true', () => {
    expect(silentResult('x').ok).toBe(true);
    expect(userResult('x').ok).toBe(true);
    expect(dualResult('x', 'y').ok).toBe(true);
  });
});
