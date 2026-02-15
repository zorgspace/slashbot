import { describe, expect, test, vi } from 'vitest';
import { createLogger } from '../src/core/kernel/logger.js';

describe('kernel logger', () => {
  test('notifies subscribers with structured payloads', () => {
    const logger = createLogger('debug');
    logger.setTerminalOutputEnabled(false);
    const entries: Array<{ level: string; message: string; hasFields: boolean }> = [];
    const unsubscribe = logger.subscribe((entry) => {
      entries.push({
        level: entry.level,
        message: entry.message,
        hasFields: Boolean(entry.fields)
      });
    });

    logger.warn('test warning', { reason: 'boom' });
    unsubscribe();
    logger.error('test error');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      level: 'warn',
      message: 'test warning',
      hasFields: true
    });
  });

  test('can mute terminal output while still notifying subscribers', () => {
    const logger = createLogger('info');
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const received: string[] = [];
    logger.subscribe((entry) => {
      received.push(entry.message);
    });

    logger.setTerminalOutputEnabled(false);
    logger.error('hidden from terminal');

    expect(received).toEqual(['hidden from terminal']);
    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });
});
