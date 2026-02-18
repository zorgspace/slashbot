import { describe, expect, test } from 'vitest';
import { sanitizeToolName, deriveToolDisplayName } from '../src/core/voltagent/tool-bridge.js';

describe('sanitizeToolName', () => {
  test('dots replaced with underscores', () => {
    expect(sanitizeToolName('shell.exec')).toBe('shell_exec');
    expect(sanitizeToolName('wallet.send')).toBe('wallet_send');
    expect(sanitizeToolName('a.b.c')).toBe('a_b_c');
  });

  test('names without dots pass through', () => {
    expect(sanitizeToolName('simple')).toBe('simple');
  });
});

describe('deriveToolDisplayName', () => {
  test('title used when present', () => {
    expect(deriveToolDisplayName('shell.exec', 'Execute')).toBe('Execute');
  });

  test('falls back to id', () => {
    expect(deriveToolDisplayName('shell.exec')).toBe('shell.exec');
    expect(deriveToolDisplayName('shell.exec', undefined)).toBe('shell.exec');
  });

  test('empty string title is used as-is (not nullish)', () => {
    expect(deriveToolDisplayName('tool', '')).toBe('');
  });
});

describe('sanitizeToolName (additional)', () => {
  test('empty string returns empty', () => {
    expect(sanitizeToolName('')).toBe('');
  });

  test('hyphens preserved', () => {
    expect(sanitizeToolName('my-tool')).toBe('my-tool');
  });

  test('numbers preserved', () => {
    expect(sanitizeToolName('tool123')).toBe('tool123');
  });

  test('underscores preserved', () => {
    expect(sanitizeToolName('my_tool')).toBe('my_tool');
  });

  test('mixed: ns.my-tool_v2', () => {
    expect(sanitizeToolName('ns.my-tool_v2')).toBe('ns_my-tool_v2');
  });

  test('single dot becomes underscore', () => {
    expect(sanitizeToolName('.')).toBe('_');
  });
});
