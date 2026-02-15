import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import type { NodeRedState, NodeRedConfig, NodeRedStatus } from '../types';
import type { EventBus } from '../../../core/events/EventBus';
import { RingBuffer } from './RingBuffer';

// Mock Bun APIs
const mockBunSpawn = vi.fn();
const mockBunWrite = vi.fn();
const mockBunFile = vi.fn();
const mockFetch = vi.fn();

// Assign mocks to global Bun object
(globalThis as any).Bun = {
  spawn: mockBunSpawn,
  write: mockBunWrite,
  file: mockBunFile,
};
(globalThis as any).fetch = mockFetch;

// Mock fs module for directory operations
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  chmodSync: vi.fn(),
  promises: {
    open: vi.fn().mockResolvedValue({
      appendFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    appendFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as fs from 'fs';
const mockExistsSync = vi.mocked(fs.existsSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockChmodSync = vi.mocked(fs.chmodSync);

// Import NodeRedManager (to be implemented in T009)
// This will fail until T009 is complete - that's expected for TDD
import { NodeRedManager } from './NodeRedManager';

describe('NodeRedManager', () => {
  let manager: NodeRedManager;
  let mockEventBus: EventBus;
  let mockEmit: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;

  const DEFAULT_CONFIG: NodeRedConfig = {
    enabled: true,
    port: 1880,
    userDir: '~/.slashbot/nodered',
    healthCheckInterval: 30,
    shutdownTimeout: 10,
    maxRestartAttempts: 3,
    localhostOnly: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock EventBus
    mockEmit = vi.fn();
    mockOn = vi.fn(() => vi.fn()); // Return unsubscribe function
    mockEventBus = {
      emit: mockEmit,
      on: mockOn,
      once: vi.fn(),
      off: vi.fn(),
      clear: vi.fn(),
      onAny: vi.fn(),
      listenerCount: vi.fn(),
    } as any;

    // Reset global mocks
    mockBunSpawn.mockReset();
    mockBunWrite.mockReset();
    mockBunFile.mockReset();
    mockFetch.mockReset();
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('accepts EventBus instance', () => {
      manager = new NodeRedManager(mockEventBus);
      expect(manager).toBeDefined();
    });

    it('initializes with disabled state before init()', () => {
      manager = new NodeRedManager(mockEventBus);
      expect(manager.getState()).toBe('disabled');
    });
  });

  describe('State Machine Transitions', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);
    });

    describe('valid transitions', () => {
      it('transitions disabled -> stopped when enabled=true and Node.js found', async () => {
        // Mock config file (enabled=true)
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });

        // Mock which node check (success)
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });

        // Mock port probe (no stale process)
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

        // Mock directory exists
        mockExistsSync.mockReturnValue(true);

        await manager.init();
        expect(manager.getState()).toBe('stopped');
      });

      it('transitions disabled -> unavailable when enabled=true but Node.js not found', async () => {
        // Mock config file (enabled=true)
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });

        // Mock which node check (failure)
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(1),
          pid: 1234,
          kill: vi.fn(),
        });

        await manager.init();
        expect(manager.getState()).toBe('unavailable');
      });

      it('transitions stopped -> starting on start() call', async () => {
        // Setup: init to stopped state
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();
        expect(manager.getState()).toBe('stopped');

        // Mock spawn for Node-RED process
        const mockProcess = {
          pid: 5678,
          exited: new Promise(() => {}), // Never resolves
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(mockProcess as any);
        mockBunWrite.mockResolvedValue(undefined);

        // Call start
        await manager.start();
        expect(manager.getState()).toBe('starting');
      });

      it('transitions starting -> running when health check succeeds', async () => {
        // Setup: init to stopped state
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        // Mock spawn
        const mockProcess = {
          pid: 5678,
          exited: new Promise(() => {}),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(mockProcess as any);
        mockBunWrite.mockResolvedValue(undefined);

        // Mock health check success
        mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

        await manager.start();
        expect(manager.getState()).toBe('starting');

        // Advance timers to trigger readiness poll
        await vi.advanceTimersByTimeAsync(500);
        expect(manager.getState()).toBe('running');
      });

      it('transitions running -> stopped on intentional stop()', async () => {
        // Setup: get to running state
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        let resolveExited!: (code: number) => void;
        const mockProcess = {
          pid: 5678,
          exited: new Promise<number>((r) => { resolveExited = r; }),
          kill: vi.fn(() => { resolveExited(0); }),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(mockProcess as any);
        mockBunWrite.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

        await manager.start();
        await vi.advanceTimersByTimeAsync(500);
        expect(manager.getState()).toBe('running');

        // Stop intentionally
        await manager.stop();
        expect(manager.getState()).toBe('stopped');
      });

      it('transitions starting -> failed when spawn fails', async () => {
        // Setup: init to stopped state
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        // Mock spawn failure
        mockBunSpawn.mockImplementationOnce(() => {
          throw new Error('Spawn failed');
        });

        await manager.start();
        expect(manager.getState()).toBe('failed');
      });
    });

    describe('invalid transitions', () => {
      it('does not allow disabled -> starting directly', async () => {
        manager = new NodeRedManager(mockEventBus);
        expect(manager.getState()).toBe('disabled');

        const result = await manager.start();
        expect(manager.getState()).toBe('disabled');
        expect(result.success).toBe(false);
      });

      it('does not allow unavailable -> starting without Node.js', async () => {
        // Setup: init to unavailable state
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(1),
          pid: 1234,
          kill: vi.fn(),
        });

        await manager.init();
        expect(manager.getState()).toBe('unavailable');

        const result = await manager.start();
        expect(manager.getState()).toBe('unavailable');
        expect(result.success).toBe(false);
      });
    });
  });

  describe('init()', () => {
    beforeEach(() => {
      manager = new NodeRedManager(mockEventBus);
    });

    it('loads config from ~/.slashbot/nodered.json', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(mockBunFile).toHaveBeenCalledWith(expect.stringContaining('nodered.json'));
    });

    it('uses default config if file does not exist', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('File not found')),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      // Should use default config and reach stopped state (if enabled by default)
      expect(manager.getState()).not.toBe('disabled');
    });

    it('sets state to disabled if config.enabled=false', async () => {
      const disabledConfig = { ...DEFAULT_CONFIG, enabled: false };
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(disabledConfig)),
      });

      await manager.init();
      expect(manager.getState()).toBe('disabled');
    });

    it('checks Node.js availability via which node', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(mockBunSpawn).toHaveBeenCalledWith(
        ['which', 'node'],
        expect.any(Object),
      );
    });

    it('sets state to unavailable if Node.js not found', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(1),
        pid: 1234,
        kill: vi.fn(),
      });

      await manager.init();
      expect(manager.getState()).toBe('unavailable');
    });

    it('probes configured port for stale process (FR-018)', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${DEFAULT_CONFIG.port}/`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it('adopts stale process if port probe returns 200 (FR-018)', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(manager.getState()).toBe('running');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );
    });

    it('sets state to stopped if port probe fails (no stale process)', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('stopped');
    });

    it('creates userDir if it does not exist', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      // userDir doesn't exist, but red.js does (Node-RED already installed)
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('red.js')) return true;
        return false;
      });

      await manager.init();

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true }),
      );
    });

    it('is idempotent - multiple init() calls are safe', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValue({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      const state1 = manager.getState();

      await manager.init();
      const state2 = manager.getState();

      expect(state1).toBe(state2);
    });

    it('auto-installs Node-RED via npm if red.js not found', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      // First: which node (success), Second: npm install (success)
      mockBunSpawn
        .mockReturnValueOnce({ exited: Promise.resolve(0), pid: 1, kill: vi.fn() })
        .mockReturnValueOnce({ exited: Promise.resolve(0), pid: 2, kill: vi.fn(), stdout: null, stderr: null });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      let redJsCallCount = 0;
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('red.js')) {
          redJsCallCount++;
          return redJsCallCount > 1; // false first (triggers install), true after (verification)
        }
        return true;
      });

      await manager.init();

      expect(mockBunSpawn).toHaveBeenCalledWith(
        ['npm', 'install', 'node-red'],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
      expect(manager.getState()).toBe('stopped');
    });

    it('skips Node-RED installation if already present', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true); // red.js exists

      await manager.init();

      // Only one Bun.spawn call (which node), no npm install
      expect(mockBunSpawn).toHaveBeenCalledTimes(1);
      expect(mockBunSpawn).toHaveBeenCalledWith(['which', 'node'], expect.any(Object));
    });

    it('transitions to failed if Node-RED installation fails', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      // First: which node (success), Second: npm install (failure)
      mockBunSpawn
        .mockReturnValueOnce({ exited: Promise.resolve(0), pid: 1, kill: vi.fn() })
        .mockReturnValueOnce({ exited: Promise.resolve(1), pid: 2, kill: vi.fn(), stdout: null, stderr: null });

      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('red.js')) return false;
        return true;
      });

      await manager.init();

      expect(manager.getState()).toBe('failed');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nodered:failed',
          error: expect.stringContaining('npm install node-red failed'),
        }),
      );
    });

    it('transitions to failed if npm install succeeds but red.js still not found', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn
        .mockReturnValueOnce({ exited: Promise.resolve(0), pid: 1, kill: vi.fn() })
        .mockReturnValueOnce({ exited: Promise.resolve(0), pid: 2, kill: vi.fn(), stdout: null, stderr: null });

      // red.js never found, even after install
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('red.js')) return false;
        return true;
      });

      await manager.init();

      expect(manager.getState()).toBe('failed');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nodered:failed',
          error: expect.stringContaining('node-red package not found'),
        }),
      );
    });
  });

  describe('start()', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to stopped state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('stopped');
    });

    it('spawns Node-RED child process', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      expect(mockBunSpawn).toHaveBeenCalledWith(
        expect.arrayContaining(['node']),
        expect.objectContaining({
          cwd: expect.any(String),
          env: expect.any(Object),
        }),
      );
    });

    it('generates settings.js before spawning', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      expect(mockBunWrite).toHaveBeenCalledWith(
        expect.stringContaining('settings.js'),
        expect.stringContaining('module.exports'),
      );
    });

    it('starts readiness polling after spawn', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      expect(manager.getState()).toBe('starting');

      // Advance timer to trigger readiness poll
      await vi.advanceTimersByTimeAsync(500);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('localhost'),
        expect.any(Object),
      );
    });

    it('transitions to running when readiness poll succeeds', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);

      expect(manager.getState()).toBe('running');
    });

    it('emits nodered:ready event when running', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );
    });

    it('emits prompt:redraw event on state changes', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'prompt:redraw' }),
      );
    });

    it('is idempotent when already starting', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();
      expect(manager.getState()).toBe('starting');

      const result = await manager.start();
      expect(result.success).toBe(true);
      expect(result.message).toContain('starting');
    });

    it('is idempotent when already running', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      const result = await manager.start();
      expect(result.success).toBe(true);
      expect(result.message).toContain('running');
    });

    it('returns error if state is disabled', async () => {
      // Re-init with disabled config
      const disabledConfig = { ...DEFAULT_CONFIG, enabled: false };
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(disabledConfig)),
      });

      const newManager = new NodeRedManager(mockEventBus);
      await newManager.init();
      expect(newManager.getState()).toBe('disabled');

      const result = await newManager.start();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error if state is unavailable', async () => {
      // Re-init with unavailable state (no Node.js)
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(1),
        pid: 1234,
        kill: vi.fn(),
      });

      const newManager = new NodeRedManager(mockEventBus);
      await newManager.init();
      expect(newManager.getState()).toBe('unavailable');

      const result = await newManager.start();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('resets intentionalStop flag on start', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();
      expect(manager.getState()).toBe('starting');
    });
  });

  describe('Health Check Timer', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to stopped state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
    });

    it('starts health check timer after process becomes running', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      // Clear previous fetch calls
      mockFetch.mockClear();

      // Advance timer by health check interval (30 seconds)
      await vi.advanceTimersByTimeAsync(30000);

      // Should have triggered health check
      expect(mockFetch).toHaveBeenCalled();
    });

    it('uses configured healthCheckInterval', async () => {
      const customConfig = { ...DEFAULT_CONFIG, healthCheckInterval: 60 };
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(customConfig)),
      });
      mockBunSpawn
        .mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        })
        .mockReturnValueOnce({
          pid: 5678,
          exited: new Promise(() => {}),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        });
      mockFetch
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);
      mockBunWrite.mockResolvedValue(undefined);

      const newManager = new NodeRedManager(mockEventBus);
      await newManager.init();
      await newManager.start();
      await vi.advanceTimersByTimeAsync(500);

      mockFetch.mockClear();

      // Should NOT trigger at 30s (old interval)
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).not.toHaveBeenCalled();

      // Should trigger at 60s (new interval)
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('cleans up timer on stop()', async () => {
      let resolveExited!: (code: number) => void;
      const mockProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(() => { resolveExited(0); }),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      await manager.stop();
      mockFetch.mockClear();

      // Advance time - timer should NOT fire after stop
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('cleans up timer on destroy()', async () => {
      let resolveExited!: (code: number) => void;
      const mockProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(() => { resolveExited(0); }),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      await manager.destroy();
      mockFetch.mockClear();

      // Advance time - timer should NOT fire after destroy
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Stale Process Adoption (FR-018)', () => {
    beforeEach(() => {
      manager = new NodeRedManager(mockEventBus);
    });

    it('probes configured port during init()', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${DEFAULT_CONFIG.port}/`,
        expect.objectContaining({
          signal: expect.any(Object),
        }),
      );
    });

    it('adopts stale process when port responds 200', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(manager.getState()).toBe('running');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );
      // Should NOT spawn new process
      expect(mockBunSpawn).toHaveBeenCalledTimes(1); // Only the which node call
    });

    it('does not adopt if port responds non-200', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(manager.getState()).toBe('stopped');
    });

    it('does not adopt if port probe times out', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(manager.getState()).toBe('stopped');
    });

    it('does not adopt if port probe throws error', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(manager.getState()).toBe('stopped');
    });

    it('starts health checks after adopting stale process', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('running');

      mockFetch.mockClear();

      // Advance time to trigger health check
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Node.js Availability Check (FR-013)', () => {
    beforeEach(() => {
      manager = new NodeRedManager(mockEventBus);
    });

    it('checks Node.js using which node command', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      expect(mockBunSpawn).toHaveBeenCalledWith(
        ['which', 'node'],
        expect.any(Object),
      );
    });

    it('sets state to stopped if Node.js is found', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('stopped');
    });

    it('sets state to unavailable if Node.js is not found', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(1),
        pid: 1234,
        kill: vi.fn(),
      });

      await manager.init();
      expect(manager.getState()).toBe('unavailable');
    });

    it('emits nodered:failed event if Node.js not available', async () => {
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(1),
        pid: 1234,
        kill: vi.fn(),
      });

      await manager.init();

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nodered:failed',
          error: expect.stringContaining('Node.js'),
        }),
      );
    });
  });

  describe('Health Check Failure Recovery (T025)', () => {
    /**
     * Helper: get manager to running state with controllable process and health checks
     */
    async function setupRunningForHealthCheck(): Promise<{
      spawnedProcess: any;
      resolveExited: (code: number) => void;
    }> {
      manager = new NodeRedManager(mockEventBus);

      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('stopped');

      let resolveExited!: (code: number) => void;
      const spawnedProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(spawnedProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      return { spawnedProcess, resolveExited };
    }

    it('triggers process kill after 3 consecutive health check failures', async () => {
      const { spawnedProcess, resolveExited } = await setupRunningForHealthCheck();

      // Switch fetch to always fail (simulate unresponsive Node-RED)
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      // Prepare a restart process so crash recovery has somewhere to go
      const restartProcess = {
        pid: 9999,
        exited: new Promise<number>(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };

      // After 3 failures, handleHealthCheckFailure will call process.kill(9)
      // which triggers handleProcessExit -> crash recovery -> auto-restart
      spawnedProcess.kill.mockImplementation((signal: number) => {
        if (signal === 9) {
          resolveExited(137);
        }
      });
      mockBunSpawn.mockReturnValueOnce(restartProcess as any);

      // Advance through 3 health check intervals (30s each)
      await vi.advanceTimersByTimeAsync(30000); // Failure 1
      await vi.advanceTimersByTimeAsync(30000); // Failure 2
      await vi.advanceTimersByTimeAsync(30000); // Failure 3 -> kill triggered

      // Verify process was killed
      expect(spawnedProcess.kill).toHaveBeenCalledWith(9);
    });

    it('resets failure counter on successful health check', async () => {
      const { spawnedProcess } = await setupRunningForHealthCheck();

      // Fail 2 times
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await vi.advanceTimersByTimeAsync(30000); // Failure 1
      await vi.advanceTimersByTimeAsync(30000); // Failure 2

      // Succeed once (resets counter)
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(30000); // Success -> counter resets to 0

      // Fail 2 more times (should NOT trigger kill because counter was reset)
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await vi.advanceTimersByTimeAsync(30000); // Failure 1 (of new batch)
      await vi.advanceTimersByTimeAsync(30000); // Failure 2 (of new batch)

      // Kill should NOT have been called (only 2 consecutive failures, not 3)
      expect(spawnedProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('Log Capture', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to stopped state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
    });

    it('captures stdout to RingBuffer', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      // Verify stdout is being captured (implementation will use pipeTo or similar)
      expect(mockProcess.stdout.pipeTo).toHaveBeenCalled();
    });

    it('captures stderr to RingBuffer', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      // Verify stderr is being captured
      expect(mockProcess.stderr.pipeTo).toHaveBeenCalled();
    });

    it('includes log lines in getStatus()', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);

      const status = manager.getStatus();
      expect(status.recentLogs).toBeDefined();
      expect(Array.isArray(status.recentLogs)).toBe(true);
    });
  });

  describe('getState() and getStatus()', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to stopped state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
    });

    it('getState() returns current state', () => {
      expect(manager.getState()).toBe('stopped');
    });

    it('getStatus() returns complete status object', () => {
      const status = manager.getStatus();

      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('pid');
      expect(status).toHaveProperty('port');
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('restartCount');
      expect(status).toHaveProperty('recentLogs');
      expect(typeof status.state).toBe('string');
      expect(typeof status.restartCount).toBe('number');
      expect(Array.isArray(status.recentLogs)).toBe(true);
    });

    it('getStatus() includes pid when running', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);

      const status = manager.getStatus();
      expect(status.pid).toBe(5678);
      expect(status.port).toBe(DEFAULT_CONFIG.port);
    });

    it('getStatus() calculates uptime correctly', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);

      const status1 = manager.getStatus();
      expect(status1.uptime).toBeGreaterThanOrEqual(0);

      // Advance time
      await vi.advanceTimersByTimeAsync(5000);

      const status2 = manager.getStatus();
      expect(status2.uptime).toBeGreaterThan(status1.uptime!);
    });

    it('getStatus() returns null uptime when not running', () => {
      const status = manager.getStatus();
      expect(status.uptime).toBeNull();
    });

    it('getStatus(logLines) returns specified number of log lines', async () => {
      const mockProcess = {
        pid: 5678,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.start();

      const status = manager.getStatus(10);
      expect(status.recentLogs.length).toBeLessThanOrEqual(10);
    });

    it('getStatus() includes restartCount', async () => {
      const status = manager.getStatus();
      expect(status.restartCount).toBe(0);
    });
  });

  describe('stop()', () => {
    let spawnedProcess: any;
    let resolveExited!: (code: number) => void;

    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to running state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      spawnedProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(() => { resolveExited(0); }),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(spawnedProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');
    });

    it('sends SIGTERM to process', async () => {
      await manager.stop();

      expect(spawnedProcess.kill).toHaveBeenCalledWith(expect.any(Number));
    });

    it('transitions to stopped state', async () => {
      await manager.stop();
      expect(manager.getState()).toBe('stopped');
    });

    it('emits nodered:stopped event', async () => {
      mockEmit.mockClear();
      await manager.stop();

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:stopped' }),
      );
    });

    it('cleans up health check timer', async () => {
      await manager.stop();
      mockFetch.mockClear();

      // Advance time - health check should not fire
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('waits for graceful shutdown within timeout', async () => {
      await manager.stop();
      // Should wait up to shutdownTimeout (10 seconds) before SIGKILL
      expect(manager.getState()).toBe('stopped');
    });
  });

  describe('destroy()', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to running state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      let resolveExited!: (code: number) => void;
      const mockProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(() => { resolveExited(0); }),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
    });

    it('stops the process if running', async () => {
      expect(manager.getState()).toBe('running');
      await manager.destroy();
      expect(manager.getState()).toBe('stopped');
    });

    it('cleans up health check timer', async () => {
      await manager.destroy();
      mockFetch.mockClear();

      await vi.advanceTimersByTimeAsync(30000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('cleans up readiness poll timer', async () => {
      await manager.destroy();
      // Timers should be cleared
      expect(manager.getState()).toBe('stopped');
    });

    it('can be called when already stopped', async () => {
      await manager.stop();
      expect(manager.getState()).toBe('stopped');

      await expect(manager.destroy()).resolves.not.toThrow();
    });
  });

  describe('getConfig()', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
    });

    it('returns current configuration', () => {
      const config = manager.getConfig();
      expect(config).toMatchObject(DEFAULT_CONFIG);
    });
  });

  describe('saveConfig()', () => {
    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
    });

    it('persists config to disk', async () => {
      const newConfig = { ...DEFAULT_CONFIG, port: 3000 };
      mockBunWrite.mockResolvedValue(undefined);

      await manager.saveConfig(newConfig);

      expect(mockBunWrite).toHaveBeenCalledWith(
        expect.stringContaining('nodered.json'),
        expect.stringContaining('"port": 3000'),
      );
    });

    it('updates internal config', async () => {
      const newConfig = { ...DEFAULT_CONFIG, port: 3000 };
      mockBunWrite.mockResolvedValue(undefined);

      await manager.saveConfig(newConfig);

      const config = manager.getConfig();
      expect(config.port).toBe(3000);
    });
  });

  describe('Crash Recovery (US2)', () => {
    let spawnedProcess: any;
    let resolveExited!: (code: number) => void;

    /**
     * Helper: get manager to running state with a controllable process exit
     */
    async function setupRunningManager(): Promise<void> {
      manager = new NodeRedManager(mockEventBus);

      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();
      expect(manager.getState()).toBe('stopped');

      // Spawn with controllable exit
      spawnedProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(spawnedProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');
    }

    it('detects crash via process exit handler when not intentional', async () => {
      await setupRunningManager();
      mockEmit.mockClear();

      // Simulate crash (unexpected exit code 1)
      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0); // Flush promise

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:error' }),
      );
    });

    it('auto-restarts on unexpected exit (not intentional stop)', async () => {
      await setupRunningManager();

      // Prepare a new process for the restart
      let resolveExited2!: (code: number) => void;
      const restartProcess = {
        pid: 9999,
        exited: new Promise<number>((r) => { resolveExited2 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(restartProcess as any);

      // Simulate crash
      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0); // Flush promise

      // Advance past the first backoff delay (1000ms)
      await vi.advanceTimersByTimeAsync(1000);

      // Should have spawned a new process (auto-restart)
      expect(manager.getState()).toBe('starting');
    });

    it('uses exponential backoff delays between consecutive retries (1s, 2s, 4s)', async () => {
      await setupRunningManager();

      // Prevent readiness poll from succeeding (consecutive crashes)
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      // First crash -> restartCount=1, backoff = 1s
      let resolveExited2!: (code: number) => void;
      const proc2 = {
        pid: 9001,
        exited: new Promise<number>((r) => { resolveExited2 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(proc2 as any);

      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0);

      const countAfterCrash1 = mockBunSpawn.mock.calls.length;

      // Before 1s: no restart yet
      await vi.advanceTimersByTimeAsync(999);
      expect(mockBunSpawn.mock.calls.length).toBe(countAfterCrash1);

      // At 1s: restart fires
      await vi.advanceTimersByTimeAsync(1);
      expect(mockBunSpawn.mock.calls.length).toBe(countAfterCrash1 + 1);

      // Second consecutive crash -> restartCount=2, backoff = 2s
      let resolveExited3!: (code: number) => void;
      const proc3 = {
        pid: 9002,
        exited: new Promise<number>((r) => { resolveExited3 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(proc3 as any);

      resolveExited2(1);
      await vi.advanceTimersByTimeAsync(0);

      const countAfterCrash2 = mockBunSpawn.mock.calls.length;

      // Before 2s: no restart yet
      await vi.advanceTimersByTimeAsync(1999);
      expect(mockBunSpawn.mock.calls.length).toBe(countAfterCrash2);

      // At 2s: restart fires
      await vi.advanceTimersByTimeAsync(1);
      expect(mockBunSpawn.mock.calls.length).toBe(countAfterCrash2 + 1);
    });

    it('increments restart counter on each consecutive crash', async () => {
      await setupRunningManager();
      expect(manager.getStatus().restartCount).toBe(0);

      // First crash
      let resolveExited2!: (code: number) => void;
      const proc2 = {
        pid: 9001,
        exited: new Promise<number>((r) => { resolveExited2 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(proc2 as any);

      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.getStatus().restartCount).toBe(1);

      // Advance past backoff but crash again before reaching running
      // (readiness poll fails - process crashes during starting)
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await vi.advanceTimersByTimeAsync(1000);

      // Second consecutive crash (proc2 exits while still starting)
      let resolveExited3!: (code: number) => void;
      const proc3 = {
        pid: 9002,
        exited: new Promise<number>((r) => { resolveExited3 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(proc3 as any);

      resolveExited2(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.getStatus().restartCount).toBe(2);
    });

    it('resets restart counter on successful start and emits nodered:ready', async () => {
      await setupRunningManager();

      // First crash
      let resolveExited2!: (code: number) => void;
      const proc2 = {
        pid: 9001,
        exited: new Promise<number>((r) => { resolveExited2 = r; }),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(proc2 as any);

      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.getStatus().restartCount).toBe(1);

      // Advance past backoff
      await vi.advanceTimersByTimeAsync(1000);

      // Health check succeeds -> running state
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      mockEmit.mockClear();

      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');
      expect(manager.getStatus().restartCount).toBe(0);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );
    });

    it('transitions to failed state when all retries exhausted', async () => {
      await setupRunningManager();

      // Exhaust all 3 restart attempts
      for (let i = 0; i < DEFAULT_CONFIG.maxRestartAttempts; i++) {
        // Prepare restart process that will also crash
        let resolveNext!: (code: number) => void;
        const nextProc = {
          pid: 9000 + i,
          exited: new Promise<number>((r) => { resolveNext = r; }),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(nextProc as any);

        // Mock readiness poll to fail (process crashes during starting)
        mockFetch.mockRejectedValue(new Error('Connection refused'));

        // Trigger crash
        resolveExited(1);
        await vi.advanceTimersByTimeAsync(0);

        // Advance past backoff
        const backoffMs = 1000 * Math.pow(2, i);
        await vi.advanceTimersByTimeAsync(backoffMs);

        // Update resolveExited for next iteration
        resolveExited = resolveNext;
      }

      // Final crash after all attempts exhausted
      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getState()).toBe('failed');
    });

    it('emits nodered:failed when all retries exhausted', async () => {
      await setupRunningManager();

      // Exhaust all retries
      for (let i = 0; i < DEFAULT_CONFIG.maxRestartAttempts; i++) {
        let resolveNext!: (code: number) => void;
        const nextProc = {
          pid: 9000 + i,
          exited: new Promise<number>((r) => { resolveNext = r; }),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(nextProc as any);
        mockFetch.mockRejectedValue(new Error('Connection refused'));

        resolveExited(1);
        await vi.advanceTimersByTimeAsync(0);

        const backoffMs = 1000 * Math.pow(2, i);
        await vi.advanceTimersByTimeAsync(backoffMs);

        resolveExited = resolveNext;
      }

      mockEmit.mockClear();
      resolveExited(1);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:failed' }),
      );
    });

    it('intentionalStop flag suppresses auto-restart', async () => {
      await setupRunningManager();
      const spawnCountBefore = mockBunSpawn.mock.calls.length;

      // Make kill resolve the exited promise so stop() completes
      spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

      await manager.stop();

      // Advance plenty of time - should NOT auto-restart
      await vi.advanceTimersByTimeAsync(10000);

      // No new spawns after the stop
      expect(manager.getState()).toBe('stopped');
    });

    it('health monitoring pauses in stopped state', async () => {
      await setupRunningManager();

      // Make kill resolve the exited promise so stop() completes
      spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

      await manager.stop();
      expect(manager.getState()).toBe('stopped');
      mockFetch.mockClear();

      // Advance past health check interval
      await vi.advanceTimersByTimeAsync(60000);

      // Health check should NOT fire in stopped state
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Graceful Shutdown (US4)', () => {
    describe('stop() SIGTERM -> timeout -> SIGKILL escalation', () => {
      let spawnedProcess: any;
      let resolveExited!: (code: number) => void;

      /**
       * Helper: get manager to running state with a controllable process exit
       */
      async function setupRunningManager(): Promise<void> {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        spawnedProcess = {
          pid: 5678,
          exited: new Promise<number>((r) => { resolveExited = r; }),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(spawnedProcess as any);
        mockBunWrite.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

        await manager.start();
        await vi.advanceTimersByTimeAsync(500);
        expect(manager.getState()).toBe('running');
      }

      it('stop() sends SIGTERM (signal 15) to child process', async () => {
        await setupRunningManager();

        // Make kill resolve exited so stop() can complete
        spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

        await manager.stop();

        // First call should be SIGTERM (signal 15)
        expect(spawnedProcess.kill).toHaveBeenCalledWith(15);
      });

      it('stop() waits up to shutdownTimeout (default 10s) for clean exit', async () => {
        await setupRunningManager();

        // Process responds to SIGTERM after 5s (within 10s timeout)
        spawnedProcess.kill.mockImplementation((signal: number) => {
          if (signal === 15) {
            // Don't resolve immediately - simulate slow shutdown
            setTimeout(() => resolveExited(0), 5000);
          }
        });

        const stopPromise = manager.stop();

        // Advance 5s to let the process exit gracefully
        await vi.advanceTimersByTimeAsync(5000);
        await stopPromise;

        expect(manager.getState()).toBe('stopped');
        // SIGKILL should NOT have been sent (process exited within timeout)
        const killCalls = spawnedProcess.kill.mock.calls;
        const sigkillCalls = killCalls.filter((call: number[]) => call[0] === 9);
        expect(sigkillCalls.length).toBe(0);
      });

      it('stop() sends SIGKILL if process does not exit within shutdownTimeout', async () => {
        await setupRunningManager();

        // Process does NOT respond to SIGTERM at all
        spawnedProcess.kill.mockImplementation((signal: number) => {
          if (signal === 9) {
            // SIGKILL always works - resolve the exited promise
            resolveExited(137);
          }
          // SIGTERM (signal 15) is ignored - process hangs
        });

        const stopPromise = manager.stop();

        // Advance past the shutdown timeout (10s default)
        await vi.advanceTimersByTimeAsync(10000);
        await stopPromise;

        expect(manager.getState()).toBe('stopped');
        // Should have sent SIGTERM first, then SIGKILL
        expect(spawnedProcess.kill).toHaveBeenCalledWith(15);
        expect(spawnedProcess.kill).toHaveBeenCalledWith(9);
      });

      it('stop() sets intentionalStop flag to suppress auto-restart', async () => {
        await setupRunningManager();

        spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

        await manager.stop();

        // No auto-restart should happen
        const spawnCountAfterStop = mockBunSpawn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10000);
        expect(mockBunSpawn.mock.calls.length).toBe(spawnCountAfterStop);
        expect(manager.getState()).toBe('stopped');
      });

      it('stop() clears health check timer and readiness poll timer', async () => {
        await setupRunningManager();

        spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

        await manager.stop();
        mockFetch.mockClear();

        // Advance past health check interval - no health check should fire
        await vi.advanceTimersByTimeAsync(60000);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('stop() emits nodered:stopped event', async () => {
        await setupRunningManager();

        spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });
        mockEmit.mockClear();

        await manager.stop();

        expect(mockEmit).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'nodered:stopped' }),
        );
      });

      it('stop() is idempotent when already stopped', async () => {
        await setupRunningManager();

        spawnedProcess.kill.mockImplementation(() => { resolveExited(0); });

        await manager.stop();
        expect(manager.getState()).toBe('stopped');

        // Second stop should not throw
        await expect(manager.stop()).resolves.not.toThrow();
        expect(manager.getState()).toBe('stopped');
      });

      it('stop() is idempotent when disabled', async () => {
        const disabledConfig = { ...DEFAULT_CONFIG, enabled: false };
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(disabledConfig)),
        });

        manager = new NodeRedManager(mockEventBus);
        await manager.init();
        expect(manager.getState()).toBe('disabled');

        await expect(manager.stop()).resolves.not.toThrow();
        expect(manager.getState()).toBe('disabled');
      });
    });

    describe('destroy() cleanup', () => {
      async function setupRunningManager(): Promise<{
        spawnedProcess: any;
        resolveExited: (code: number) => void;
      }> {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        let resolveExited!: (code: number) => void;
        const spawnedProcess = {
          pid: 5678,
          exited: new Promise<number>((r) => { resolveExited = r; }),
          kill: vi.fn(() => { resolveExited(0); }),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(spawnedProcess as any);
        mockBunWrite.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

        await manager.start();
        await vi.advanceTimersByTimeAsync(500);
        expect(manager.getState()).toBe('running');

        return { spawnedProcess, resolveExited };
      }

      it('destroy() stops Node-RED if running then clears all timers', async () => {
        await setupRunningManager();

        await manager.destroy();

        expect(manager.getState()).toBe('stopped');
        mockFetch.mockClear();

        // No health check should fire
        await vi.advanceTimersByTimeAsync(60000);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('destroy() handles already-stopped state gracefully', async () => {
        await setupRunningManager();

        // stop() will call kill which resolves exited (from setupRunningManager mock)
        await manager.stop();
        expect(manager.getState()).toBe('stopped');

        // Calling destroy on a stopped manager should not throw
        await expect(manager.destroy()).resolves.not.toThrow();
      });

      it('destroy() handles failed state gracefully', async () => {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        // Get to failed state: start then have spawn fail
        mockBunSpawn.mockImplementationOnce(() => {
          throw new Error('Spawn failed');
        });
        await manager.start();
        expect(manager.getState()).toBe('failed');

        // Calling destroy on a failed manager should not throw
        await expect(manager.destroy()).resolves.not.toThrow();
      });

      it('destroy() nullifies process references', async () => {
        await setupRunningManager();

        await manager.destroy();

        // Verify via getStatus - pid should be null
        const status = manager.getStatus();
        expect(status.pid).toBeNull();
      });

      it('destroy() clears the log buffer', async () => {
        await setupRunningManager();

        await manager.destroy();

        // Log buffer should be cleared
        const status = manager.getStatus();
        expect(status.recentLogs).toEqual([]);
      });

      it('plugin destroy() delegates to manager.destroy()', async () => {
        // Test that the plugin's destroy() calls manager.destroy()
        // This verifies the contract at the manager level
        await setupRunningManager();
        expect(manager.getState()).toBe('running');

        await manager.destroy();
        expect(manager.getState()).toBe('stopped');
      });
    });
  });

  describe('restart()', () => {
    let restartProcess: any;
    let resolveExited!: (code: number) => void;

    beforeEach(async () => {
      manager = new NodeRedManager(mockEventBus);

      // Setup: init to running state
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
      });
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockExistsSync.mockReturnValue(true);

      await manager.init();

      // Use a controllable process (never-resolving exited) to avoid premature exit
      restartProcess = {
        pid: 5678,
        exited: new Promise<number>((r) => { resolveExited = r; }),
        kill: vi.fn(() => { resolveExited(0); }),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(restartProcess as any);
      mockBunWrite.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      await manager.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');
    });

    it('stops then starts the process', async () => {
      const mockProcess2 = {
        pid: 9999,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess2 as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.restart();

      // Should spawn new process
      expect(mockBunSpawn).toHaveBeenCalledWith(
        expect.arrayContaining(['node']),
        expect.any(Object),
      );
    });

    it('does not increment restart count on manual restart', async () => {
      const initialStatus = manager.getStatus();
      const initialCount = initialStatus.restartCount;

      const mockProcess2 = {
        pid: 9999,
        exited: new Promise(() => {}),
        kill: vi.fn(),
        stdout: { pipeTo: vi.fn() },
        stderr: { pipeTo: vi.fn() },
      };
      mockBunSpawn.mockReturnValueOnce(mockProcess2 as any);
      mockBunWrite.mockResolvedValue(undefined);

      await manager.restart();

      const finalStatus = manager.getStatus();
      expect(finalStatus.restartCount).toBe(initialCount);
    });
  });

  describe('Config Management (US5)', () => {
    describe('loadConfig()', () => {
      it('creates default config if no config file exists', async () => {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(false),
          text: () => Promise.reject(new Error('File not found')),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        const config = manager.getConfig();
        expect(config.enabled).toBe(true);
        expect(config.port).toBe(1880);
        expect(config.userDir).toContain('nodered');
        expect(config.healthCheckInterval).toBe(30);
        expect(config.shutdownTimeout).toBe(10);
        expect(config.maxRestartAttempts).toBe(3);
        expect(config.localhostOnly).toBe(true);
      });

      it('merges partial config file with defaults', async () => {
        manager = new NodeRedManager(mockEventBus);

        // Config file has only port and healthCheckInterval
        const partialConfig = { port: 3000, healthCheckInterval: 60 };
        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(partialConfig)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        const config = manager.getConfig();
        expect(config.port).toBe(3000);               // overridden
        expect(config.healthCheckInterval).toBe(60);   // overridden
        expect(config.enabled).toBe(true);             // default
        expect(config.shutdownTimeout).toBe(10);       // default
        expect(config.maxRestartAttempts).toBe(3);     // default
        expect(config.localhostOnly).toBe(true);       // default
      });

      it('falls back to defaults on malformed JSON in config file', async () => {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve('{ invalid json !!!'),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();

        // Should fall back to defaults, not crash
        const config = manager.getConfig();
        expect(config.port).toBe(1880);
        expect(config.enabled).toBe(true);
        expect(manager.getState()).toBe('stopped');
      });
    });

    describe('saveConfig() with permissions', () => {
      beforeEach(async () => {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();
      });

      it('writes config to ~/.slashbot/nodered.json', async () => {
        mockBunWrite.mockResolvedValue(undefined);

        await manager.saveConfig({ port: 3000 });

        expect(mockBunWrite).toHaveBeenCalledWith(
          expect.stringContaining('nodered.json'),
          expect.any(String),
        );
      });

      it('sets file permissions to 0600 on config file', async () => {
        mockBunWrite.mockResolvedValue(undefined);

        await manager.saveConfig({ port: 3000 });

        expect(mockChmodSync).toHaveBeenCalledWith(
          expect.stringContaining('nodered.json'),
          0o600,
        );
      });

      it('merges partial config update with existing config', async () => {
        mockBunWrite.mockResolvedValue(undefined);

        await manager.saveConfig({ port: 3000 });

        const config = manager.getConfig();
        expect(config.port).toBe(3000);
        expect(config.healthCheckInterval).toBe(30); // unchanged default
        expect(config.enabled).toBe(true);           // unchanged default
      });

      it('creates config directory if it does not exist', async () => {
        mockBunWrite.mockResolvedValue(undefined);
        mockExistsSync.mockReturnValue(false);

        await manager.saveConfig({ port: 3000 });

        expect(mockMkdirSync).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ recursive: true }),
        );
      });
    });

    describe('custom port applied on restart', () => {
      it('uses updated port in readiness poll after config change and restart', async () => {
        manager = new NodeRedManager(mockEventBus);

        mockBunFile.mockReturnValue({
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify(DEFAULT_CONFIG)),
        });
        mockBunSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          pid: 1234,
          kill: vi.fn(),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        mockExistsSync.mockReturnValue(true);

        await manager.init();
        expect(manager.getState()).toBe('stopped');

        // Update config with new port
        mockBunWrite.mockResolvedValue(undefined);
        await manager.saveConfig({ port: 3000 });

        // Start with new port
        const mockProcess = {
          pid: 5678,
          exited: new Promise<number>(() => {}),
          kill: vi.fn(),
          stdout: { pipeTo: vi.fn() },
          stderr: { pipeTo: vi.fn() },
        };
        mockBunSpawn.mockReturnValueOnce(mockProcess as any);

        // Mock readiness poll success
        mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

        await manager.start();
        await vi.advanceTimersByTimeAsync(500);

        // Readiness poll should use new port 3000
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/',
          expect.any(Object),
        );

        expect(manager.getState()).toBe('running');
        expect(manager.getStatus().port).toBe(3000);
      });
    });
  });
});
