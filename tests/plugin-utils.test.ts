import { describe, expect, test } from 'vitest';
import {
  asObject,
  asString,
  asNonEmptyString,
  asStringArray,
  asOptionalStringArray,
  splitMessage,
  stripHtml,
  slugify,
} from '../src/plugins/utils.js';

describe('asObject', () => {
  test('passes objects', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
  });

  test('throws on arrays', () => {
    expect(() => asObject([1, 2])).toThrow('Expected object');
  });

  test('throws on primitives', () => {
    expect(() => asObject('string' as never)).toThrow('Expected object');
    expect(() => asObject(42 as never)).toThrow('Expected object');
    expect(() => asObject(null as never)).toThrow('Expected object');
  });
});

describe('asString', () => {
  test('passes strings', () => {
    expect(asString('hello', 'field')).toBe('hello');
  });

  test('throws on non-strings', () => {
    expect(() => asString(42, 'field')).toThrow('Expected string');
    expect(() => asString(undefined, 'field')).toThrow('Expected string');
  });
});

describe('asNonEmptyString', () => {
  test('passes non-empty strings', () => {
    expect(asNonEmptyString('hello', 'field')).toBe('hello');
  });

  test('throws on empty string', () => {
    expect(() => asNonEmptyString('', 'field')).toThrow('Expected string field');
  });

  test('throws on non-strings', () => {
    expect(() => asNonEmptyString(42, 'field')).toThrow('Expected string field');
  });
});

describe('asStringArray', () => {
  test('passes string arrays', () => {
    expect(asStringArray(['a', 'b'], 'field')).toEqual(['a', 'b']);
  });

  test('defaults to empty array for undefined', () => {
    expect(asStringArray(undefined, 'field')).toEqual([]);
  });

  test('throws on non-string arrays', () => {
    expect(() => asStringArray([1, 2] as never, 'field')).toThrow('Expected string[]');
  });
});

describe('asOptionalStringArray', () => {
  test('normalizes with maxItems cap', () => {
    const result = asOptionalStringArray(['a', 'b', 'c', 'd', 'e', 'f'], 3);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  test('returns undefined for non-arrays', () => {
    expect(asOptionalStringArray('not array')).toBeUndefined();
    expect(asOptionalStringArray(undefined)).toBeUndefined();
  });

  test('filters empty strings', () => {
    const result = asOptionalStringArray(['a', '', '  ', 'b']);
    expect(result).toEqual(['a', 'b']);
  });

  test('returns undefined for all-empty array', () => {
    expect(asOptionalStringArray(['', '  '])).toBeUndefined();
  });
});

describe('splitMessage', () => {
  test('short message returned as single chunk', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  test('respects newline boundary', () => {
    const text = 'line1\nline2\nline3\nline4';
    const parts = splitMessage(text, 12);
    expect(parts.length).toBeGreaterThan(1);
    // Each part should be complete lines
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(12);
    }
  });

  test('empty string returns empty array', () => {
    expect(splitMessage('', 100)).toEqual([]);
    expect(splitMessage('   ', 100)).toEqual([]);
  });

  test('handles edge case where no newline found', () => {
    const text = 'a'.repeat(20);
    const parts = splitMessage(text, 10);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe('a'.repeat(10));
    expect(parts[1]).toBe('a'.repeat(10));
  });
});

describe('stripHtml', () => {
  test('removes scripts and styles', () => {
    const html = '<script>alert("x")</script><style>.x{}</style><p>Hello</p>';
    const result = stripHtml(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.x');
    expect(result).toContain('Hello');
  });

  test('removes tags', () => {
    expect(stripHtml('<b>Bold</b> <i>Italic</i>')).toBe('Bold Italic');
  });

  test('decodes entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
  });
});

describe('slugify', () => {
  test('lowercase and special chars to hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  test('max 40 chars', () => {
    const long = 'a'.repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });

  test('strips leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  test('consecutive special chars collapsed to single hyphen', () => {
    expect(slugify('a!!b')).toBe('a-b');
  });

  test('numbers preserved', () => {
    expect(slugify('version2')).toBe('version2');
  });

  test('empty string returns empty', () => {
    expect(slugify('')).toBe('');
  });
});

describe('asObject (additional)', () => {
  test('nested objects pass through', () => {
    expect(asObject({ nested: { deep: true } })).toEqual({ nested: { deep: true } });
  });

  test('empty object passes', () => {
    expect(asObject({})).toEqual({});
  });
});

describe('asString (additional)', () => {
  test('empty string is valid', () => {
    expect(asString('', 'field')).toBe('');
  });
});

describe('asStringArray (additional)', () => {
  test('empty array returns empty', () => {
    expect(asStringArray([], 'f')).toEqual([]);
  });

  test('throws on non-array object', () => {
    expect(() => asStringArray({} as never, 'f')).toThrow();
  });
});

describe('asOptionalStringArray (additional)', () => {
  test('default maxItems is 5', () => {
    const result = asOptionalStringArray(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(result).toHaveLength(5);
  });

  test('trims whitespace', () => {
    const result = asOptionalStringArray([' hello ', ' world ']);
    expect(result).toEqual(['hello', 'world']);
  });
});

describe('splitMessage (additional)', () => {
  test('very long single line splits at boundary', () => {
    const text = 'a'.repeat(20);
    const parts = splitMessage(text, 10);
    expect(parts.length).toBe(2);
  });
});

describe('stripHtml (additional)', () => {
  test('plain text passes through', () => {
    expect(stripHtml('just text')).toBe('just text');
  });

  test('nested tags', () => {
    expect(stripHtml('<div><span>text</span></div>')).toBe('text');
  });
});
