import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryStore } from '../src/plugins/services/memory-store.js';

describe('MemoryStore', () => {
  test('upsert creates file and appends entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-'));
    try {
      const store = new MemoryStore(dir);
      const r1 = await store.upsert({ text: 'First fact' });
      expect(r1.path).toContain('notes.md');
      expect(r1.line).toBe(1);

      const r2 = await store.upsert({ text: 'Second fact', tags: ['test'] });
      expect(r2.line).toBe(2);

      const content = await readFile(join(dir, '.slashbot', 'memory', 'notes.md'), 'utf8');
      expect(content).toContain('First fact');
      expect(content).toContain('Second fact');
      expect(content).toContain('[tags: test]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('search returns BM25-scored results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-search-'));
    try {
      const store = new MemoryStore(dir);
      // Create a memory file with content
      const memDir = join(dir, '.slashbot', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(dir, '.slashbot', 'MEMORY.md'), '# Project Memory\n\nReact TypeScript project\nUses Vitest for testing\nDatabase is PostgreSQL', 'utf8');

      const hits = await store.search('testing');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].score).toBeGreaterThan(0);
      expect(hits[0].text.toLowerCase()).toContain('test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('search returns empty for empty query', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-empty-'));
    try {
      const store = new MemoryStore(dir);
      const hits = await store.search('');
      expect(hits).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('get reads file with line numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-get-'));
    try {
      const memDir = join(dir, '.slashbot');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, 'MEMORY.md'), 'Line 1\nLine 2\nLine 3\n', 'utf8');

      const store = new MemoryStore(dir);
      const content = await store.get('MEMORY.md');
      expect(content).toContain('1: Line 1');
      expect(content).toContain('2: Line 2');
      expect(content).toContain('3: Line 3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('get with path traversal throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-traversal-'));
    try {
      const store = new MemoryStore(dir);
      await expect(store.get('../../etc/passwd')).rejects.toThrow('escapes memory directory');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('stats returns file and chunk counts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-stats-'));
    try {
      const memDir = join(dir, '.slashbot');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, 'MEMORY.md'), 'Line 1\nLine 2\n', 'utf8');

      const store = new MemoryStore(dir);
      const stats = await store.stats();
      expect(stats.files).toBe(1);
      expect(stats.chunks).toBe(2);
      expect(stats.indexedAt).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('upsert to custom file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-custom-'));
    try {
      const store = new MemoryStore(dir);
      const result = await store.upsert({ text: 'custom fact', file: 'custom.md' });
      expect(result.path).toContain('custom.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('search results ordered by score (highest first)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-order-'));
    try {
      const memDir = join(dir, '.slashbot');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, 'MEMORY.md'), 'React project setup\nReact testing with Vitest\nDatabase PostgreSQL config\n', 'utf8');

      const store = new MemoryStore(dir);
      const hits = await store.search('React');
      if (hits.length > 1) {
        for (let i = 1; i < hits.length; i++) {
          expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('search with limit returns at most N results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-limit-'));
    try {
      const memDir = join(dir, '.slashbot');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, 'MEMORY.md'), 'fact one\nfact two\nfact three\n', 'utf8');

      const store = new MemoryStore(dir);
      const hits = await store.search('fact', 1);
      expect(hits.length).toBeLessThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('stats with no memory files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-empty2-'));
    try {
      const store = new MemoryStore(dir);
      const stats = await store.stats();
      expect(stats.files).toBe(0);
      expect(stats.chunks).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('multiple upserts to same file accumulate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-multi-'));
    try {
      const store = new MemoryStore(dir);
      await store.upsert({ text: 'First' });
      await store.upsert({ text: 'Second' });
      await store.upsert({ text: 'Third' });

      const content = await readFile(join(dir, '.slashbot', 'memory', 'notes.md'), 'utf8');
      expect(content).toContain('First');
      expect(content).toContain('Second');
      expect(content).toContain('Third');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('search with no matching content returns empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-nomatch-'));
    try {
      const memDir = join(dir, '.slashbot');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, 'MEMORY.md'), 'Completely unrelated content\n', 'utf8');

      const store = new MemoryStore(dir);
      const hits = await store.search('xyznonexistent');
      expect(hits).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('upsert with multiple tags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slashbot-mem-tags-'));
    try {
      const store = new MemoryStore(dir);
      await store.upsert({ text: 'Tagged fact', tags: ['alpha', 'beta'] });

      const content = await readFile(join(dir, '.slashbot', 'memory', 'notes.md'), 'utf8');
      expect(content).toContain('alpha');
      expect(content).toContain('beta');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
