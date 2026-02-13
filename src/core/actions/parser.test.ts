import { describe, expect, it } from 'vitest';
import { extractAttr, extractBoolAttr } from './parser';

describe('action parser attribute extraction', () => {
  it('parses attributes case-insensitively', () => {
    const tag = '<agent-create autoPoll="true" systemPrompt="Do work"/>';
    expect(extractAttr(tag, 'autopoll')).toBe('true');
    expect(extractAttr(tag, 'systemprompt')).toBe('Do work');
  });

  it('supports single-quoted and unquoted attributes', () => {
    const tag = "<fetch url='https://example.com' retries=3/>";
    expect(extractAttr(tag, 'url')).toBe('https://example.com');
    expect(extractAttr(tag, 'retries')).toBe('3');
  });

  it('parses truthy boolean variants', () => {
    expect(extractBoolAttr('<tag enabled="true"/>', 'enabled')).toBe(true);
    expect(extractBoolAttr('<tag enabled="YES"/>', 'enabled')).toBe(true);
    expect(extractBoolAttr('<tag enabled="1"/>', 'enabled')).toBe(true);
    expect(extractBoolAttr('<tag enabled="false"/>', 'enabled')).toBe(false);
  });
});
