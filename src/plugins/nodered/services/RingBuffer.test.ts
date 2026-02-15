import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from './RingBuffer';

describe('RingBuffer', () => {
  let buffer: RingBuffer;

  describe('constructor', () => {
    it('creates buffer with default capacity of 200 lines', () => {
      buffer = new RingBuffer();
      expect(buffer.size).toBe(0);
      // Verify capacity by filling beyond 200 and checking wrapping
      for (let i = 0; i < 250; i++) {
        buffer.push(`line ${i}`);
      }
      expect(buffer.size).toBe(200);
    });

    it('creates buffer with custom capacity', () => {
      buffer = new RingBuffer(50);
      expect(buffer.size).toBe(0);
      // Fill beyond custom capacity
      for (let i = 0; i < 100; i++) {
        buffer.push(`line ${i}`);
      }
      expect(buffer.size).toBe(50);
    });

    it('handles capacity of 1', () => {
      buffer = new RingBuffer(1);
      buffer.push('first');
      buffer.push('second');
      expect(buffer.size).toBe(1);
      expect(buffer.tail(1)).toEqual(['second']);
    });

    it('handles large capacity', () => {
      buffer = new RingBuffer(10000);
      for (let i = 0; i < 5000; i++) {
        buffer.push(`line ${i}`);
      }
      expect(buffer.size).toBe(5000);
    });
  });

  describe('push', () => {
    beforeEach(() => {
      buffer = new RingBuffer(5);
    });

    it('adds items to the buffer', () => {
      buffer.push('line 1');
      expect(buffer.size).toBe(1);
      buffer.push('line 2');
      expect(buffer.size).toBe(2);
      buffer.push('line 3');
      expect(buffer.size).toBe(3);
    });

    it('stores lines in order', () => {
      buffer.push('first');
      buffer.push('second');
      buffer.push('third');
      expect(buffer.tail()).toEqual(['first', 'second', 'third']);
    });

    it('handles empty string lines', () => {
      buffer.push('');
      buffer.push('non-empty');
      buffer.push('');
      expect(buffer.size).toBe(3);
      expect(buffer.tail()).toEqual(['', 'non-empty', '']);
    });

    it('handles multiline content as single entry', () => {
      buffer.push('line 1\nline 2\nline 3');
      expect(buffer.size).toBe(1);
      expect(buffer.tail()).toEqual(['line 1\nline 2\nline 3']);
    });

    it('handles special characters and unicode', () => {
      buffer.push('日本語');
      buffer.push('emoji 🚀');
      buffer.push('special chars: !@#$%^&*()');
      expect(buffer.size).toBe(3);
      expect(buffer.tail()).toEqual(['日本語', 'emoji 🚀', 'special chars: !@#$%^&*()']);
    });
  });

  describe('size property', () => {
    beforeEach(() => {
      buffer = new RingBuffer(10);
    });

    it('reflects current count', () => {
      expect(buffer.size).toBe(0);
      buffer.push('a');
      expect(buffer.size).toBe(1);
      buffer.push('b');
      expect(buffer.size).toBe(2);
      buffer.push('c');
      expect(buffer.size).toBe(3);
    });

    it('does not exceed capacity', () => {
      for (let i = 0; i < 20; i++) {
        buffer.push(`line ${i}`);
      }
      expect(buffer.size).toBe(10);
    });

    it('is readonly', () => {
      // TypeScript should prevent this at compile time, but runtime test
      expect(() => {
        (buffer as any).size = 999;
      }).toThrow();
    });
  });

  describe('capacity enforcement (wrapping)', () => {
    beforeEach(() => {
      buffer = new RingBuffer(3);
    });

    it('wraps when buffer is full', () => {
      buffer.push('line 0');
      buffer.push('line 1');
      buffer.push('line 2');
      expect(buffer.size).toBe(3);
      expect(buffer.tail()).toEqual(['line 0', 'line 1', 'line 2']);

      // Push one more - should discard oldest (line 0)
      buffer.push('line 3');
      expect(buffer.size).toBe(3);
      expect(buffer.tail()).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('discards oldest items when full', () => {
      for (let i = 0; i < 10; i++) {
        buffer.push(`line ${i}`);
      }
      // Should keep last 3: line 7, line 8, line 9
      expect(buffer.tail()).toEqual(['line 7', 'line 8', 'line 9']);
    });

    it('maintains correct order after multiple wraps', () => {
      for (let i = 0; i < 100; i++) {
        buffer.push(`line ${i}`);
      }
      // Should keep last 3: line 97, line 98, line 99
      expect(buffer.tail()).toEqual(['line 97', 'line 98', 'line 99']);
    });

    it('handles continuous wrapping with interleaved reads', () => {
      buffer.push('a');
      buffer.push('b');
      expect(buffer.tail(2)).toEqual(['a', 'b']);

      buffer.push('c');
      expect(buffer.tail(3)).toEqual(['a', 'b', 'c']);

      buffer.push('d'); // Wraps, discards 'a'
      expect(buffer.tail(3)).toEqual(['b', 'c', 'd']);

      buffer.push('e'); // Wraps, discards 'b'
      expect(buffer.tail(3)).toEqual(['c', 'd', 'e']);
    });
  });

  describe('tail', () => {
    beforeEach(() => {
      buffer = new RingBuffer(10);
      buffer.push('line 0');
      buffer.push('line 1');
      buffer.push('line 2');
      buffer.push('line 3');
      buffer.push('line 4');
    });

    it('returns last n items', () => {
      expect(buffer.tail(3)).toEqual(['line 2', 'line 3', 'line 4']);
      expect(buffer.tail(2)).toEqual(['line 3', 'line 4']);
      expect(buffer.tail(1)).toEqual(['line 4']);
    });

    it('returns all items when n is not provided', () => {
      expect(buffer.tail()).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
    });

    it('returns all items when n exceeds buffer size', () => {
      expect(buffer.tail(100)).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
    });

    it('returns empty array when n is 0', () => {
      expect(buffer.tail(0)).toEqual([]);
    });

    it('handles negative n by returning empty array', () => {
      expect(buffer.tail(-1)).toEqual([]);
      expect(buffer.tail(-10)).toEqual([]);
    });

    it('returns correct tail after wrapping', () => {
      const smallBuffer = new RingBuffer(3);
      smallBuffer.push('a');
      smallBuffer.push('b');
      smallBuffer.push('c');
      smallBuffer.push('d'); // Wraps
      smallBuffer.push('e'); // Wraps

      expect(smallBuffer.tail(2)).toEqual(['d', 'e']);
      expect(smallBuffer.tail()).toEqual(['c', 'd', 'e']);
    });

    it('does not mutate buffer state', () => {
      const result1 = buffer.tail(2);
      const result2 = buffer.tail(2);
      expect(result1).toEqual(result2);
      expect(buffer.size).toBe(5);
    });

    it('returns independent array copies', () => {
      const result = buffer.tail(2);
      result.push('mutated');
      expect(buffer.tail(2)).toEqual(['line 3', 'line 4']);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      buffer = new RingBuffer(10);
      buffer.push('line 1');
      buffer.push('line 2');
      buffer.push('line 3');
    });

    it('resets the buffer', () => {
      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.tail()).toEqual([]);
    });

    it('allows new pushes after clear', () => {
      buffer.clear();
      buffer.push('new line 1');
      buffer.push('new line 2');
      expect(buffer.size).toBe(2);
      expect(buffer.tail()).toEqual(['new line 1', 'new line 2']);
    });

    it('can be called multiple times', () => {
      buffer.clear();
      buffer.clear();
      expect(buffer.size).toBe(0);
    });

    it('resets internal pointers correctly', () => {
      // Fill to capacity
      for (let i = 0; i < 15; i++) {
        buffer.push(`line ${i}`);
      }
      buffer.clear();
      // Push new items - should start from beginning
      buffer.push('a');
      buffer.push('b');
      expect(buffer.tail()).toEqual(['a', 'b']);
    });
  });

  describe('empty buffer behavior', () => {
    beforeEach(() => {
      buffer = new RingBuffer(10);
    });

    it('has size 0 when empty', () => {
      expect(buffer.size).toBe(0);
    });

    it('tail returns empty array when buffer is empty', () => {
      expect(buffer.tail()).toEqual([]);
      expect(buffer.tail(5)).toEqual([]);
    });

    it('handles push and clear to return to empty state', () => {
      buffer.push('test');
      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.tail()).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('simulates log capture for Node-RED output (200-line default)', () => {
      buffer = new RingBuffer(); // Default 200 capacity

      // Simulate Node-RED startup logs
      buffer.push('[info] Starting Node-RED...');
      buffer.push('[info] Loading flows...');
      buffer.push('[info] Server listening on port 1880');

      expect(buffer.tail(1)).toEqual(['[info] Server listening on port 1880']);
      expect(buffer.size).toBe(3);

      // Simulate many runtime logs
      for (let i = 0; i < 300; i++) {
        buffer.push(`[debug] Flow message ${i}`);
      }

      // Should keep last 200 only
      expect(buffer.size).toBe(200);
      expect(buffer.tail(1)).toEqual(['[debug] Flow message 299']);
    });

    it('handles rapid successive pushes', () => {
      buffer = new RingBuffer(50);

      // Rapid logs
      for (let i = 0; i < 1000; i++) {
        buffer.push(`rapid log ${i}`);
      }

      expect(buffer.size).toBe(50);
      // Last 3 should be 997, 998, 999
      expect(buffer.tail(3)).toEqual([
        'rapid log 997',
        'rapid log 998',
        'rapid log 999',
      ]);
    });

    it('supports /nodered status command use case (last N lines)', () => {
      buffer = new RingBuffer();

      // Simulate various log levels
      buffer.push('[info] Node-RED started');
      buffer.push('[warn] Deprecated node used');
      buffer.push('[error] Flow deployment failed');
      buffer.push('[info] Flow deployed successfully');
      buffer.push('[debug] HTTP request received');

      // Command requests last 3 lines
      const recentLogs = buffer.tail(3);
      expect(recentLogs).toEqual([
        '[error] Flow deployment failed',
        '[info] Flow deployed successfully',
        '[debug] HTTP request received',
      ]);
    });
  });

  describe('edge cases', () => {
    it('handles capacity of 0 (degenerate case)', () => {
      buffer = new RingBuffer(0);
      buffer.push('line 1');
      buffer.push('line 2');
      expect(buffer.size).toBe(0);
      expect(buffer.tail()).toEqual([]);
    });

    it('handles very long strings', () => {
      buffer = new RingBuffer(5);
      const longString = 'x'.repeat(100000);
      buffer.push(longString);
      expect(buffer.size).toBe(1);
      expect(buffer.tail(1)[0]).toBe(longString);
    });

    it('handles tail with decimal n (treated as integer)', () => {
      buffer = new RingBuffer(10);
      buffer.push('a');
      buffer.push('b');
      buffer.push('c');
      // JavaScript should truncate 2.7 to 2
      expect(buffer.tail(2.7)).toEqual(['b', 'c']);
    });
  });
});
