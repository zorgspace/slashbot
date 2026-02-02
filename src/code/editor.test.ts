import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeEditor } from './editor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CodeEditor', () => {
  let editor: CodeEditor;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashbot-test-'));
    editor = new CodeEditor(testDir);
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('editFile', () => {
    it('replaces first occurrence by default', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'foo bar foo baz foo');

      const result = await editor.editFile({
        path: 'test.ts',
        search: 'foo',
        replace: 'qux',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('applied');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('qux bar foo baz foo');
    });

    it('replaces all occurrences when replaceAll is true', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'foo bar foo baz foo');

      const result = await editor.editFile({
        path: 'test.ts',
        search: 'foo',
        replace: 'qux',
        replaceAll: true,
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('qux bar qux baz qux');
    });

    it('returns already_applied when content unchanged', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'const x = 1;');

      const result = await editor.editFile({
        path: 'test.ts',
        search: 'const x = 1;',
        replace: 'const x = 1;',
      });

      expect(result.status).toBe('already_applied');
      expect(result.success).toBe(true);
    });

    it('handles whitespace-normalized matching', async () => {
      const filePath = path.join(testDir, 'test.ts');
      // File has 2-space indentation
      fs.writeFileSync(filePath, 'function foo() {\n  return 1;\n}');

      // Search with 4-space indentation (common copy-paste issue)
      const result = await editor.editFile({
        path: 'test.ts',
        search: 'function foo() {\n    return 1;\n}',
        replace: 'function bar() {\n  return 2;\n}',
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('bar');
    });

    it('returns not_found for missing file', async () => {
      const result = await editor.editFile({
        path: 'nonexistent.ts',
        search: 'foo',
        replace: 'bar',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
      expect(result.message).toContain('File not found');
    });

    it('returns not_found for missing pattern', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'const x = 1;');

      const result = await editor.editFile({
        path: 'test.ts',
        search: 'const y = 2;',
        replace: 'const z = 3;',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });
  });

  describe('multiEditFile', () => {
    it('applies multiple edits atomically', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'const a = 1;\nconst b = 2;\nconst c = 3;');

      const result = await editor.multiEditFile('test.ts', [
        { search: 'const a = 1;', replace: 'const x = 10;' },
        { search: 'const b = 2;', replace: 'const y = 20;' },
      ]);

      expect(result.success).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe('const x = 10;\nconst y = 20;\nconst c = 3;');
    });

    it('aborts all edits if one fails', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const originalContent = 'const a = 1;\nconst b = 2;';
      fs.writeFileSync(filePath, originalContent);

      const result = await editor.multiEditFile('test.ts', [
        { search: 'const a = 1;', replace: 'const x = 10;' },
        { search: 'NONEXISTENT', replace: 'something' }, // This will fail
      ]);

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
      // Original content should be unchanged
      expect(fs.readFileSync(filePath, 'utf8')).toBe(originalContent);
    });

    it('supports replaceAll in multi-edit', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'foo foo bar foo');

      const result = await editor.multiEditFile('test.ts', [
        { search: 'foo', replace: 'baz', replaceAll: true },
      ]);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('baz baz bar baz');
    });
  });

  describe('readFile', () => {
    it('reads file content', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'hello world');

      const content = await editor.readFile('test.ts');
      expect(content).toBe('hello world');
    });

    it('returns null for missing file', async () => {
      const content = await editor.readFile('nonexistent.ts');
      expect(content).toBeNull();
    });
  });

  describe('createFile', () => {
    it('creates new file', async () => {
      const result = await editor.createFile('new-file.ts', 'content');
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'new-file.ts'))).toBe(true);
    });

    it('creates directories as needed', async () => {
      const result = await editor.createFile('deep/nested/file.ts', 'content');
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'deep/nested/file.ts'))).toBe(true);
    });
  });
});
