import { describe, expect, test } from 'vitest';
import { truncateToolResult } from '../src/core/agentic/context/tool-result-truncator.js';

const defaultConfig = {
  contextLimit: 128_000,
  toolResultMaxContextShare: 0.25,
  toolResultHardMax: 100_000,
  toolResultMinKeep: 500,
};

describe('truncateToolResult', () => {
  test('short result returned as-is', () => {
    const result = truncateToolResult('short output', defaultConfig);
    expect(result).toBe('short output');
  });

  test('long result truncated with marker', () => {
    const longResult = 'x'.repeat(200_000);
    const truncated = truncateToolResult(longResult, defaultConfig);
    expect(truncated.length).toBeLessThan(longResult.length);
    expect(truncated).toContain('[... truncated');
    expect(truncated).toContain('characters ...]');
  });

  test('prefers newline boundary for cut point', () => {
    const lines = Array.from({ length: 10000 }, (_, i) => `Line ${i}: data`).join('\n');
    const truncated = truncateToolResult(lines, {
      ...defaultConfig,
      toolResultHardMax: 500,
    });
    expect(truncated).toContain('[... truncated');
    // Should cut at a newline, so the last line before marker should be complete
    const beforeMarker = truncated.split('\n\n[... truncated')[0];
    expect(beforeMarker.endsWith('data')).toBe(true);
  });

  test('respects toolResultMinKeep', () => {
    const result = 'x'.repeat(1000);
    const truncated = truncateToolResult(result, {
      ...defaultConfig,
      toolResultHardMax: 100,
      toolResultMinKeep: 800,
    });
    // minKeep should override the maxChars calculation
    expect(truncated.length).toBeGreaterThan(100);
  });

  test('empty string returned as-is', () => {
    expect(truncateToolResult('', defaultConfig)).toBe('');
  });

  test('result exactly at limit is not truncated', () => {
    // maxChars = min(128000*4*0.25, 100000) = 100000
    const result = 'x'.repeat(100_000);
    const truncated = truncateToolResult(result, defaultConfig);
    expect(truncated).toBe(result);
  });

  test('result one char over limit triggers truncation marker', () => {
    const result = 'x'.repeat(100_001);
    const truncated = truncateToolResult(result, defaultConfig);
    expect(truncated).toContain('[... truncated');
  });

  test('truncation marker includes character count', () => {
    const result = 'x'.repeat(200_000);
    const truncated = truncateToolResult(result, defaultConfig);
    expect(truncated).toMatch(/\[... truncated \d+ characters \.\.\.\]/);
  });

  test('very small toolResultHardMax', () => {
    const result = 'x'.repeat(100);
    const truncated = truncateToolResult(result, {
      ...defaultConfig,
      toolResultHardMax: 10,
      toolResultMinKeep: 5,
    });
    expect(truncated).toContain('[... truncated');
  });

  test('aggressive toolResultMaxContextShare', () => {
    const result = 'x'.repeat(10_000);
    const truncated = truncateToolResult(result, {
      ...defaultConfig,
      toolResultMaxContextShare: 0.001,
    });
    expect(truncated).toContain('[... truncated');
  });

  test('no newlines: cuts at exact limit', () => {
    const result = 'x'.repeat(1000);
    const truncated = truncateToolResult(result, {
      ...defaultConfig,
      toolResultHardMax: 500,
      toolResultMinKeep: 100,
    });
    expect(truncated).toContain('[... truncated');
  });

  test('JSON result gets truncated properly', () => {
    const json = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, value: 'x'.repeat(20) })));
    const truncated = truncateToolResult(json, {
      ...defaultConfig,
      toolResultHardMax: 500,
    });
    expect(truncated).toContain('[... truncated');
    expect(truncated.length).toBeLessThan(json.length);
  });
});
