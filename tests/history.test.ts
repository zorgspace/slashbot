import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { appendHistory, clearHistory, loadHistory } from '../src/core/history.js';

describe('persistent prompt history', () => {
  test('persists entries under user home and reloads them', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-history-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      clearHistory();
      appendHistory('first prompt');
      appendHistory('second prompt');

      const loaded = loadHistory();
      expect(loaded).toEqual(['first prompt', 'second prompt']);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
