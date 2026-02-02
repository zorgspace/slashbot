import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeActions } from './executor';
import type { Action, ActionHandlers } from './types';

describe('executeActions', () => {
  let mockHandlers: ActionHandlers;
  let readCallCount: number;
  let globCallCount: number;
  let bashCallCount: number;

  beforeEach(() => {
    readCallCount = 0;
    globCallCount = 0;
    bashCallCount = 0;

    mockHandlers = {
      onRead: vi.fn().mockImplementation(async (path: string) => {
        readCallCount++;
        return `Content of ${path}`;
      }),
      onWrite: vi.fn().mockResolvedValue(true),
      onBash: vi.fn().mockImplementation(async () => {
        bashCallCount++;
        return 'bash output';
      }),
      onGlob: vi.fn().mockImplementation(async () => {
        globCallCount++;
        return ['file1.ts', 'file2.ts'];
      }),
      onGrep: vi.fn().mockResolvedValue('grep results'),
      onLS: vi.fn().mockResolvedValue(['dir1', 'dir2']),
      onFetch: vi.fn().mockResolvedValue('fetched content'),
      onSearch: vi.fn().mockResolvedValue([]),
      onNotify: vi.fn().mockResolvedValue(undefined),
      onTask: vi.fn().mockResolvedValue('task result'),
    };
  });

  describe('oneAtATime mode (default)', () => {
    it('executes only the first action when multiple actions provided', async () => {
      const actions: Action[] = [
        { type: 'read', path: '/file1.ts' },
        { type: 'read', path: '/file2.ts' },
        { type: 'read', path: '/file3.ts' },
      ];

      const results = await executeActions(actions, mockHandlers);

      expect(results).toHaveLength(1);
      expect(readCallCount).toBe(1);
      expect(mockHandlers.onRead).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onRead).toHaveBeenCalledWith('/file1.ts', {
        offset: undefined,
        limit: undefined,
      });
    });

    it('returns result of first action only', async () => {
      const actions: Action[] = [
        { type: 'read', path: '/first.ts' },
        { type: 'read', path: '/second.ts' },
      ];

      const results = await executeActions(actions, mockHandlers);

      expect(results).toHaveLength(1);
      expect(results[0].action).toContain('/first.ts');
      expect(results[0].success).toBe(true);
    });

    it('executes single action normally', async () => {
      const actions: Action[] = [{ type: 'read', path: '/only.ts' }];

      const results = await executeActions(actions, mockHandlers);

      expect(results).toHaveLength(1);
      expect(mockHandlers.onRead).toHaveBeenCalledTimes(1);
    });

    it('returns empty array for empty actions list', async () => {
      const results = await executeActions([], mockHandlers);

      expect(results).toHaveLength(0);
      expect(mockHandlers.onRead).not.toHaveBeenCalled();
    });
  });

  describe('batch mode (oneAtATime = false)', () => {
    it('executes all actions when oneAtATime is false', async () => {
      const actions: Action[] = [
        { type: 'read', path: '/file1.ts' },
        { type: 'read', path: '/file2.ts' },
        { type: 'read', path: '/file3.ts' },
      ];

      const results = await executeActions(actions, mockHandlers, false);

      expect(results).toHaveLength(3);
      expect(readCallCount).toBe(3);
      expect(mockHandlers.onRead).toHaveBeenCalledTimes(3);
    });

    it('executes actions in order', async () => {
      const callOrder: string[] = [];
      mockHandlers.onRead = vi.fn().mockImplementation(async (path: string) => {
        callOrder.push(path);
        return `Content of ${path}`;
      });

      const actions: Action[] = [
        { type: 'read', path: '/first.ts' },
        { type: 'read', path: '/second.ts' },
        { type: 'read', path: '/third.ts' },
      ];

      await executeActions(actions, mockHandlers, false);

      expect(callOrder).toEqual(['/first.ts', '/second.ts', '/third.ts']);
    });

    it('returns all results', async () => {
      const actions: Action[] = [
        { type: 'read', path: '/a.ts' },
        { type: 'read', path: '/b.ts' },
      ];

      const results = await executeActions(actions, mockHandlers, false);

      expect(results).toHaveLength(2);
      expect(results[0].action).toContain('/a.ts');
      expect(results[1].action).toContain('/b.ts');
    });
  });

  describe('mixed action types', () => {
    it('executes only first action regardless of type (oneAtATime)', async () => {
      const actions: Action[] = [
        { type: 'glob', pattern: '**/*.ts' },
        { type: 'read', path: '/file.ts' },
        { type: 'bash', command: 'echo test' },
      ];

      const results = await executeActions(actions, mockHandlers);

      expect(results).toHaveLength(1);
      expect(results[0].action).toContain('**/*.ts');
      expect(globCallCount).toBe(1);
      expect(readCallCount).toBe(0);
      expect(bashCallCount).toBe(0);
    });

    it('executes all action types when batch mode', async () => {
      const actions: Action[] = [
        { type: 'glob', pattern: '**/*.ts' },
        { type: 'read', path: '/file.ts' },
      ];

      const results = await executeActions(actions, mockHandlers, false);

      expect(results).toHaveLength(2);
      expect(globCallCount).toBe(1);
      expect(readCallCount).toBe(1);
    });
  });

  describe('token savings', () => {
    it('prevents unnecessary action execution by defaulting to oneAtATime', async () => {
      // Simulate LLM generating many actions at once
      const actions: Action[] = [
        { type: 'read', path: '/check-first.ts' },
        { type: 'read', path: '/might-not-need.ts' },
        { type: 'read', path: '/also-might-skip.ts' },
        { type: 'bash', command: 'npm test' },
        { type: 'bash', command: 'npm build' },
      ];

      const results = await executeActions(actions, mockHandlers);

      // Only first action should run, saving tokens by not executing
      // potentially unnecessary subsequent actions
      expect(results).toHaveLength(1);
      expect(readCallCount).toBe(1);
      expect(bashCallCount).toBe(0);
    });
  });
});
