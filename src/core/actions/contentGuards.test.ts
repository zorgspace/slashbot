import { describe, expect, it } from 'vitest';
import { detectEscapedNewlineCorruption, repairStructuralEscapedNewlines } from './contentGuards';

describe('contentGuards', () => {
  it('repairs structural escaped newlines', () => {
    const input = 'const a = 1;\\n  const b = 2;\\nif (a) {\\n  return b;\\n}';

    expect(detectEscapedNewlineCorruption(input)).toBeTruthy();

    const repaired = repairStructuralEscapedNewlines(input);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('\n');
    expect(repaired.content).not.toContain('\\n  const b');
    expect(detectEscapedNewlineCorruption(repaired.content)).toBeNull();
  });

  it('does not mutate escaped newlines inside string literals', () => {
    const input = 'const msg = "\\\\n";';

    expect(detectEscapedNewlineCorruption(input)).toBeNull();
    const repaired = repairStructuralEscapedNewlines(input);
    expect(repaired.changed).toBe(false);
    expect(repaired.content).toBe(input);
  });

  it('does not mutate escaped newlines inside comments', () => {
    const input = '// keep \\\\n literal in comment';

    expect(detectEscapedNewlineCorruption(input)).toBeNull();
    const repaired = repairStructuralEscapedNewlines(input);
    expect(repaired.changed).toBe(false);
    expect(repaired.content).toBe(input);
  });
});
