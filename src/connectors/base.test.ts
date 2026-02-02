import { describe, it, expect } from 'vitest';
import { splitMessage, PLATFORM_CONFIGS } from './base';

describe('splitMessage', () => {
  it('returns single chunk for short message', () => {
    const result = splitMessage('Hello world', 100);
    expect(result).toEqual(['Hello world']);
  });

  it('returns single chunk when message equals maxLength', () => {
    const message = 'a'.repeat(100);
    const result = splitMessage(message, 100);
    expect(result).toEqual([message]);
  });

  it('splits at newline when possible', () => {
    const message = 'Line 1\nLine 2\nLine 3';
    const result = splitMessage(message, 10);
    expect(result.length).toBeGreaterThan(1);
    // Should split at first newline since "Line 1" fits in 10 chars
    expect(result[0]).toBe('Line 1');
  });

  it('splits at space when no newline found', () => {
    const message = 'word1 word2 word3 word4 word5';
    const result = splitMessage(message, 12);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should end at a word boundary
    result.forEach(chunk => {
      expect(chunk.endsWith(' ')).toBe(false);
    });
  });

  it('hard splits when no space or newline found', () => {
    const message = 'abcdefghijklmnopqrstuvwxyz';
    const result = splitMessage(message, 10);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('abcdefghij');
    expect(result[1]).toBe('klmnopqrst');
    expect(result[2]).toBe('uvwxyz');
  });

  it('trims whitespace at start of subsequent chunks', () => {
    const message = 'Hello world this is a test';
    const result = splitMessage(message, 12);
    result.slice(1).forEach(chunk => {
      expect(chunk.startsWith(' ')).toBe(false);
    });
  });

  it('handles empty string', () => {
    const result = splitMessage('', 100);
    expect(result).toEqual(['']);
  });

  it('handles string with only newlines', () => {
    const message = '\n\n\n';
    const result = splitMessage(message, 2);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('respects Telegram maxLength', () => {
    const longMessage = 'a'.repeat(5000);
    const result = splitMessage(longMessage, PLATFORM_CONFIGS.telegram.maxMessageLength);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(4000);
    expect(result[1].length).toBe(1000);
  });

  it('respects Discord maxLength', () => {
    const longMessage = 'a'.repeat(3000);
    const result = splitMessage(longMessage, PLATFORM_CONFIGS.discord.maxMessageLength);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(2000);
    expect(result[1].length).toBe(1000);
  });

  it('prefers newline split over space split', () => {
    const message = 'Line one here\nLine two here';
    const result = splitMessage(message, 20);
    // Should split at newline, not at space within "Line one here"
    expect(result[0]).toBe('Line one here');
    expect(result[1]).toBe('Line two here');
  });
});

describe('PLATFORM_CONFIGS', () => {
  it('has correct CLI config', () => {
    expect(PLATFORM_CONFIGS.cli).toEqual({
      maxMessageLength: Infinity,
      supportsMarkdown: true,
      conciseMode: false,
    });
  });

  it('has correct Telegram config', () => {
    expect(PLATFORM_CONFIGS.telegram).toEqual({
      maxMessageLength: 4000,
      supportsMarkdown: true,
      conciseMode: true,
    });
  });

  it('has correct Discord config', () => {
    expect(PLATFORM_CONFIGS.discord).toEqual({
      maxMessageLength: 2000,
      supportsMarkdown: true,
      conciseMode: true,
    });
  });
});
