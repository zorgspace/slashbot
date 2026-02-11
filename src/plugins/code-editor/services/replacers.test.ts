import { describe, it, expect } from 'vitest';
import { replace } from './replacers';

// ── Helpers ─────────────────────────────────────────────────────

function ok(content: string, oldStr: string, newStr: string, replaceAll = false): string {
  return replace(content, oldStr, newStr, replaceAll);
}

function shouldThrow(content: string, oldStr: string, newStr: string, msgPart?: string): void {
  expect(() => replace(content, oldStr, newStr)).toThrow(msgPart);
}

// ── 1. SimpleReplacer (exact match) ─────────────────────────────

describe('SimpleReplacer (exact)', () => {
  it('replaces an exact unique match', () => {
    const result = ok('hello world', 'world', 'earth');
    expect(result).toBe('hello earth');
  });

  it('replaces multiline exact match', () => {
    const content = 'line1\nline2\nline3';
    const result = ok(content, 'line2', 'replaced');
    expect(result).toBe('line1\nreplaced\nline3');
  });

  it('replaces with empty string (deletion)', () => {
    const result = ok('abc def ghi', ' def', '');
    expect(result).toBe('abc ghi');
  });

  it('handles duplicate occurrences via MultiOccurrenceReplacer', () => {
    const content = 'foo bar foo';
    // SimpleReplacer bails on non-unique; MultiOccurrenceReplacer handles it
    // But without replaceAll, it should throw (multiple matches)
    // Actually MultiOccurrenceReplacer yields the match, and the replace() function
    // finds it at multiple positions (indexOf !== lastIndexOf) so it skips, then throws
    shouldThrow(content, 'foo', 'baz', 'multiple matches');
  });

  it('replaces all with replaceAll flag', () => {
    const content = 'foo bar foo';
    const result = ok(content, 'foo', 'baz', true);
    expect(result).toBe('baz bar baz');
  });
});

// ── 2. LineTrimmedReplacer ──────────────────────────────────────

describe('LineTrimmedReplacer (line-trimmed)', () => {
  it('matches when search lines have different indentation', () => {
    const content = ['function foo() {', '    const x = 1;', '    return x;', '}'].join('\n');
    const search = ['const x = 1;', 'return x;'].join('\n');
    const repl = ['    const x = 2;', '    return x * 2;'].join('\n');

    const result = ok(content, search, repl);
    expect(result).toBe(
      ['function foo() {', '    const x = 2;', '    return x * 2;', '}'].join('\n'),
    );
  });
});

// ── 3. BlockAnchorReplacer ──────────────────────────────────────

describe('BlockAnchorReplacer (block-anchor)', () => {
  it('matches when first/last lines anchor and middle is slightly different', () => {
    const content = [
      'function greet() {',
      '  console.log("hello world");',
      '  return true;',
      '}',
    ].join('\n');
    const search = [
      'function greet() {',
      '  console.log("hello wrld");',
      '  return true;',
      '}',
    ].join('\n');
    const repl = ['function greet() {', '  console.log("goodbye");', '  return false;', '}'].join(
      '\n',
    );

    const result = ok(content, search, repl);
    expect(result).toBe(repl);
  });
});

// ── 4. WhitespaceNormalizedReplacer ─────────────────────────────

describe('WhitespaceNormalizedReplacer (whitespace-normalized)', () => {
  it('matches when internal whitespace differs', () => {
    const content = ['if(x  &&  y) {', '  doSomething(  a,  b  );', '}'].join('\n');
    const search = ['if(x && y) {', '  doSomething( a, b );', '}'].join('\n');
    const repl = ['if (x && y) {', '  doOther(a, b);', '}'].join('\n');

    const result = ok(content, search, repl);
    expect(result).toBe(repl);
  });
});

// ── 5. IndentationFlexibleReplacer ──────────────────────────────

describe('IndentationFlexibleReplacer (indentation-flexible)', () => {
  it('matches when search has different base indentation', () => {
    const content = ['    foo();', '    bar();'].join('\n');
    const search = ['foo();', 'bar();'].join('\n');
    const repl = ['    baz();', '    qux();'].join('\n');

    const result = ok(content, search, repl);
    expect(result).toBe(repl);
  });
});

// ── 6. EscapeNormalizedReplacer ─────────────────────────────────

describe('EscapeNormalizedReplacer (escape-normalized)', () => {
  it('matches when search contains literal \\n instead of newline', () => {
    const content = 'line1\nline2\nline3';
    const search = 'line1\\nline2';
    const repl = 'replaced';

    const result = ok(content, search, repl);
    expect(result).toBe('replaced\nline3');
  });

  it('handles literal \\t in search', () => {
    const content = 'col1\tcol2\tcol3';
    const search = 'col1\\tcol2';
    const repl = 'A\tB';

    const result = ok(content, search, repl);
    expect(result).toBe('A\tB\tcol3');
  });
});

// ── 7. TrimmedBoundaryReplacer ──────────────────────────────────

describe('TrimmedBoundaryReplacer (trimmed-boundary)', () => {
  it('matches substring with trimmed boundaries', () => {
    const content = 'aaa hello world bbb';
    const search = '  hello world  ';
    const repl = 'goodbye';

    const result = ok(content, search, repl);
    expect(result).toBe('aaa goodbye bbb');
  });

  it('matches when search has leading newlines', () => {
    const content = 'abc def ghi';
    const search = '\nabc def\n';
    const repl = 'XYZ';

    const result = ok(content, search, repl);
    expect(result).toBe('XYZ ghi');
  });
});

// ── 8. ContextAwareReplacer ─────────────────────────────────────

describe('ContextAwareReplacer (context-aware)', () => {
  it('matches with first/last anchor and 50%+ middle similarity', () => {
    const content = [
      'function render() {',
      '  const el = document.getElementById("app");',
      '  el.innerHTML = "<h1>Hello</h1>";',
      '  return el;',
      '}',
    ].join('\n');
    const search = [
      'function render() {',
      '  const element = getById("app");',
      '  element.html = "<h1>Greetings</h1>";',
      '  return el;',
      '}',
    ].join('\n');
    const repl = ['function render() {', '  return null;', '}'].join('\n');

    const result = ok(content, search, repl);
    expect(result).toBe(repl);
  });
});

// ── Failure cases ───────────────────────────────────────────────

describe('failure cases', () => {
  it('throws when no strategy matches', () => {
    shouldThrow(
      'hello world',
      'completely different text that does not exist',
      'whatever',
      'not found',
    );
  });

  it('throws for empty content with non-empty search', () => {
    shouldThrow('', 'something', 'else', 'not found');
  });

  it('throws when oldString equals newString', () => {
    shouldThrow('hello', 'hello', 'hello', 'must be different');
  });

  it('throws when multiple matches and no replaceAll', () => {
    shouldThrow('foo bar foo', 'foo', 'baz', 'multiple matches');
  });
});

// ── Real-world scenarios ────────────────────────────────────────

describe('real-world scenarios', () => {
  it('handles LLM outputting code with wrong indentation level', () => {
    const content = [
      'export class Service {',
      '  private value: number;',
      '',
      '  constructor() {',
      '    this.value = 0;',
      '  }',
      '',
      '  getValue(): number {',
      '    return this.value;',
      '  }',
      '}',
    ].join('\n');

    const search = ['getValue(): number {', '  return this.value;', '}'].join('\n');
    const repl = ['  getValue(): number {', '    return this.value * 2;', '  }'].join('\n');

    const result = ok(content, search, repl);
    expect(result).toContain('return this.value * 2');
  });

  it('handles search block with trailing newline from LLM', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const search = 'const x = 1;\n';
    const repl = 'const x = 10;\n';

    const result = ok(content, search, repl);
    expect(result).toContain('const x = 10;');
  });

  it('handles multiple sequential replacements (simulating multi-block edit)', () => {
    let content = [
      'function a() { return 1; }',
      'function b() { return 2; }',
      'function c() { return 3; }',
    ].join('\n');

    content = ok(content, 'function a() { return 1; }', 'function a() { return 10; }');
    content = ok(content, 'function c() { return 3; }', 'function c() { return 30; }');

    expect(content).toBe(
      [
        'function a() { return 10; }',
        'function b() { return 2; }',
        'function c() { return 30; }',
      ].join('\n'),
    );
  });

  it('handles TypeScript with complex indentation', () => {
    const content = [
      'class MyComponent {',
      '  render() {',
      '    return (',
      '      <div>',
      '        <span>{this.props.name}</span>',
      '      </div>',
      '    );',
      '  }',
      '}',
    ].join('\n');

    const search = [
      '  return (',
      '    <div>',
      '      <span>{this.props.name}</span>',
      '    </div>',
      '  );',
    ].join('\n');

    const repl = [
      '    return (',
      '      <div>',
      '        <span>{this.props.label}</span>',
      '      </div>',
      '    );',
    ].join('\n');

    const result = ok(content, search, repl);
    expect(result).toContain('this.props.label');
  });

  it('replaceAll replaces all occurrences', () => {
    const content = 'TODO: fix\nTODO: check\nTODO: test';
    const result = ok(content, 'TODO', 'DONE', true);
    expect(result).toBe('DONE: fix\nDONE: check\nDONE: test');
  });
});
