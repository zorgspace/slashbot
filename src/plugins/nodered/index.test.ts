/**
 * Integration test for NodeRedPlugin - Full lifecycle
 *
 * Tests the plugin as a whole unit, verifying:
 * - Plugin initialization with DI wiring
 * - Sidebar contributions with dynamic state labels
 * - Command contributions registration
 * - Prompt contributions
 * - Full lifecycle: init -> start -> health probe -> stop -> destroy
 * - Plugin destroy delegates to manager cleanup
 *
 * NOTE: This test mocks Bun.spawn and fetch to avoid requiring
 * Node.js + Node-RED installed. For real integration testing with
 * a live Node-RED instance, run manually with prerequisites met.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from '../../core/di/types';
import type { PluginContext } from '../types';
import type { NodeRedState } from './types';

// Mock Bun APIs before importing the plugin
const mockBunSpawn = vi.fn();
const mockBunWrite = vi.fn();
const mockBunFile = vi.fn();
const mockFetch = vi.fn();

(globalThis as any).Bun = {
  spawn: mockBunSpawn,
  write: mockBunWrite,
  file: mockBunFile,
};
(globalThis as any).fetch = mockFetch;

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
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

// Mock display service
vi.mock('../../core/ui', () => ({
  display: {
    append: vi.fn(),
    violet: vi.fn(),
    successText: vi.fn(),
    errorText: vi.fn(),
    muted: vi.fn(),
    warningText: vi.fn(),
  },
}));

import { NodeRedPlugin } from './index';
import { NodeRedManager } from './services/NodeRedManager';

describe('NodeRedPlugin Integration', () => {
  let plugin: NodeRedPlugin;
  let container: Container;
  let mockEmit: ReturnType<typeof vi.fn>;
  let context: PluginContext;

  /**
   * Helper: set up mocks for a successful init to stopped state
   * (enabled, Node.js found, no stale process)
   */
  function setupInitMocks(): void {
    mockBunFile.mockReturnValue({
      exists: () => Promise.resolve(true),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            enabled: true,
            port: 1880,
            userDir: '~/.slashbot/nodered',
            healthCheckInterval: 30,
            shutdownTimeout: 10,
            maxRestartAttempts: 3,
            localhostOnly: true,
          }),
        ),
    });
    // Mock `which node` success
    mockBunSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      pid: 1234,
      kill: vi.fn(),
    });
    // Mock port probe failure (no stale process)
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
  }

  /**
   * Helper: set up mocks for disabled init (enabled=false)
   */
  function setupDisabledMocks(): void {
    mockBunFile.mockReturnValue({
      exists: () => Promise.resolve(true),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            enabled: false,
            port: 1880,
            userDir: '~/.slashbot/nodered',
            healthCheckInterval: 30,
            shutdownTimeout: 10,
            maxRestartAttempts: 3,
            localhostOnly: true,
          }),
        ),
    });
  }

  /**
   * Helper: create a mock spawned process with controllable exit.
   * By default, kill() resolves the exited promise to avoid hanging in afterEach.
   */
  function createMockProcess(opts?: {
    autoResolveKill?: boolean;
  }): {
    process: any;
    resolveExited: (code: number) => void;
  } {
    const autoResolve = opts?.autoResolveKill ?? true;
    let resolveExited!: (code: number) => void;
    const exitedPromise = new Promise<number>((r) => {
      resolveExited = r;
    });
    const process = {
      pid: 5678,
      exited: exitedPromise,
      kill: vi.fn(),
      stdout: { pipeTo: vi.fn() },
      stderr: { pipeTo: vi.fn() },
    };
    if (autoResolve) {
      process.kill.mockImplementation(() => {
        resolveExited(0);
      });
    }
    return { process, resolveExited };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create a fresh DI container with EventBus
    container = new Container({ defaultScope: 'Singleton' });

    mockEmit = vi.fn();
    const mockEventBus = {
      emit: mockEmit,
      on: vi.fn(() => vi.fn()),
      once: vi.fn(),
      off: vi.fn(),
      clear: vi.fn(),
      onAny: vi.fn(),
      listenerCount: vi.fn(),
    };
    container.bind(TYPES.EventBus).toConstantValue(mockEventBus);

    context = { container } as PluginContext;
    plugin = new NodeRedPlugin();
  });

  afterEach(async () => {
    // Flush any pending timers (needed for stop() shutdown timeout under fake timers)
    try {
      const destroyPromise = plugin.destroy?.();
      // Advance timers to allow stop()'s shutdown timeout to fire
      await vi.advanceTimersByTimeAsync(15000);
      await destroyPromise;
    } catch {
      // Ignore cleanup errors
    }
    vi.useRealTimers();
  });

  describe('Plugin Metadata', () => {
    it('has correct metadata', () => {
      expect(plugin.metadata.id).toBe('feature.nodered');
      expect(plugin.metadata.name).toBe('Node-RED');
      expect(plugin.metadata.category).toBe('feature');
    });
  });

  describe('Plugin Initialization', () => {
    it('registers NodeRedManager in DI container on init', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      expect(container.isBound(TYPES.NodeRedManager)).toBe(true);
      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      expect(manager).toBeInstanceOf(NodeRedManager);
    });

    it('initializes manager during init', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      // Disabled config -> stays in disabled state
      expect(manager.getState()).toBe('disabled');
    });

    it('auto-starts Node-RED when enabled and Node.js available', async () => {
      setupInitMocks();

      // Mock spawn for auto-start
      const { process: mockProcess } = createMockProcess();
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      // Should be in starting state after auto-start
      expect(manager.getState()).toBe('starting');
    });

    it('does not auto-start when disabled', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      expect(manager.getState()).toBe('disabled');
    });

    it('does not duplicate DI binding on multiple init calls', async () => {
      setupDisabledMocks();
      await plugin.init(context);
      expect(container.isBound(TYPES.NodeRedManager)).toBe(true);

      // Second init should not throw due to duplicate binding
      const plugin2 = new NodeRedPlugin();
      setupDisabledMocks();
      await expect(plugin2.init(context)).resolves.not.toThrow();
    });
  });

  describe('Sidebar Contributions', () => {
    it('returns sidebar contribution with dynamic label', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const contributions = plugin.getSidebarContributions();
      expect(contributions).toHaveLength(1);
      expect(contributions[0].id).toBe('nodered');
      expect(contributions[0].order).toBe(25);
    });

    it('sidebar label reflects disabled state', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const contributions = plugin.getSidebarContributions();
      expect(contributions[0].label).toBe('NR: Disabled');
    });

    it('sidebar label reflects stopped state', async () => {
      setupInitMocks();

      // Provide spawn mock for auto-start, then stop
      const { process: mockProcess } = createMockProcess();
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      await manager.stop();

      const contributions = plugin.getSidebarContributions();
      expect(contributions[0].label).toBe('NR: Stopped');
    });

    it('sidebar getStatus() returns false when not running', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const contributions = plugin.getSidebarContributions();
      expect(contributions[0].getStatus()).toBe(false);
    });

    it('sidebar label updates dynamically as state changes', async () => {
      setupInitMocks();

      // Mock spawn for auto-start
      const { process: mockProcess } = createMockProcess();
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);

      const contributions = plugin.getSidebarContributions();
      // After auto-start, should be in starting state
      expect(contributions[0].label).toBe('NR: Starting');

      // Simulate readiness poll success
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(500);

      // Now should be running
      expect(contributions[0].label).toBe('NR: Running');
      expect(contributions[0].getStatus()).toBe(true);
    });
  });

  describe('Command Contributions', () => {
    it('returns command handlers after init', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const commands = plugin.getCommandContributions();
      expect(commands).toBeDefined();
      expect(commands.length).toBeGreaterThan(0);
    });

    it('command handler has name nodered', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const commands = plugin.getCommandContributions();
      const noderedCmd = commands.find(
        (cmd: any) => cmd.name === 'nodered',
      );
      expect(noderedCmd).toBeDefined();
    });

    it('command handler has alias nr', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const commands = plugin.getCommandContributions();
      const noderedCmd = commands.find(
        (cmd: any) => cmd.name === 'nodered',
      );
      expect(noderedCmd?.aliases).toContain('nr');
    });
  });

  describe('Prompt Contributions', () => {
    it('returns prompt contributions', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const prompts = plugin.getPromptContributions();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].id).toBe('feature.nodered.docs');
      expect(prompts[0].priority).toBe(160);
    });

    it('prompt content includes nodered commands', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const prompts = plugin.getPromptContributions();
      const content = prompts[0].content as string;
      expect(content).toContain('/nodered start');
      expect(content).toContain('/nodered stop');
      expect(content).toContain('/nodered restart');
      expect(content).toContain('/nodered status');
    });
  });

  describe('Action Contributions', () => {
    it('returns empty action contributions', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      const actions = plugin.getActionContributions();
      expect(actions).toEqual([]);
    });
  });

  describe('Full Lifecycle: spawn -> health probe -> stop', () => {
    it('completes full lifecycle: init -> auto-start -> running -> stop -> destroy', async () => {
      setupInitMocks();

      // Mock spawn for auto-start
      const { process: mockProcess, resolveExited } = createMockProcess();
      mockProcess.kill.mockImplementation(() => {
        resolveExited(0);
      });
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      // 1. Init (auto-starts because enabled=true)
      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      expect(manager.getState()).toBe('starting');

      // 2. Health probe succeeds -> running
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      // 3. Verify running status
      const status = manager.getStatus();
      expect(status.state).toBe('running');
      expect(status.pid).toBe(5678);
      expect(status.port).toBe(1880);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.restartCount).toBe(0);

      // 4. Verify nodered:ready event was emitted
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );

      // 5. Stop
      await manager.stop();
      expect(manager.getState()).toBe('stopped');

      // 6. Verify nodered:stopped event was emitted
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:stopped' }),
      );

      // 7. Destroy
      await plugin.destroy();
      expect(manager.getState()).toBe('stopped');
    });

    it('lifecycle with crash recovery: start -> crash -> auto-restart -> running', async () => {
      setupInitMocks();

      // First process (will crash - manual exit control)
      const { process: proc1, resolveExited: resolveExited1 } =
        createMockProcess({ autoResolveKill: false });
      mockBunSpawn.mockReturnValueOnce(proc1);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);
      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      expect(manager.getState()).toBe('starting');

      // Become running
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      // Prepare restart process
      const { process: proc2 } = createMockProcess();
      mockBunSpawn.mockReturnValueOnce(proc2);

      // Simulate crash (unexpected exit)
      resolveExited1(1);
      await vi.advanceTimersByTimeAsync(0); // Flush promise

      // Verify crash detected
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:error' }),
      );
      expect(manager.getStatus().restartCount).toBe(1);

      // Advance past backoff (1s for first retry)
      await vi.advanceTimersByTimeAsync(1000);
      expect(manager.getState()).toBe('starting');

      // Readiness poll succeeds
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      // Restart counter reset on success
      expect(manager.getStatus().restartCount).toBe(0);
    });

    it('lifecycle with graceful shutdown via destroy', async () => {
      setupInitMocks();

      const { process: mockProcess, resolveExited } = createMockProcess();
      mockProcess.kill.mockImplementation(() => {
        resolveExited(0);
      });
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);
      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);

      // Become running
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      // Destroy (simulates slashbot shutdown)
      await plugin.destroy();

      expect(manager.getState()).toBe('stopped');
      expect(mockProcess.kill).toHaveBeenCalled();

      // Timers should be cleaned up - no health checks after destroy
      mockFetch.mockClear();
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('lifecycle with stale process adoption', async () => {
      // Setup: config file exists with enabled=true
      mockBunFile.mockReturnValue({
        exists: () => Promise.resolve(true),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              enabled: true,
              port: 1880,
              userDir: '~/.slashbot/nodered',
              healthCheckInterval: 30,
              shutdownTimeout: 10,
              maxRestartAttempts: 3,
              localhostOnly: true,
            }),
          ),
      });
      // Mock `which node` success
      mockBunSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        pid: 1234,
        kill: vi.fn(),
      });
      // Mock port probe SUCCESS (stale process found)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      await plugin.init(context);

      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
      // Should have adopted the stale process and be running
      expect(manager.getState()).toBe('running');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nodered:ready' }),
      );

      // No spawn should have been called (beyond `which node`)
      const spawnCalls = mockBunSpawn.mock.calls;
      expect(spawnCalls).toHaveLength(1); // Only `which node`
    });
  });

  describe('Plugin Destroy', () => {
    it('destroy is safe when not initialized', async () => {
      // Plugin with no init
      const uninitPlugin = new NodeRedPlugin();
      // destroy should not throw even without init
      await expect(uninitPlugin.destroy()).resolves.not.toThrow();
    });

    it('destroy stops running process', async () => {
      setupInitMocks();

      const { process: mockProcess, resolveExited } = createMockProcess();
      mockProcess.kill.mockImplementation(() => {
        resolveExited(0);
      });
      mockBunSpawn.mockReturnValueOnce(mockProcess);
      mockBunWrite.mockResolvedValue(undefined);

      await plugin.init(context);
      const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);

      // Become running
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.getState()).toBe('running');

      await plugin.destroy();
      expect(manager.getState()).toBe('stopped');
    });

    it('destroy is safe on already-stopped manager', async () => {
      setupDisabledMocks();
      await plugin.init(context);

      await expect(plugin.destroy()).resolves.not.toThrow();
    });
  });

  describe('State Label Mapping', () => {
    const stateLabels: [string, string][] = [
      ['disabled', 'NR: Disabled'],
      ['stopped', 'NR: Stopped'],
      ['starting', 'NR: Starting'],
      ['running', 'NR: Running'],
      ['failed', 'NR: Failed'],
      ['unavailable', 'NR: Unavailable'],
    ];

    it.each(stateLabels)(
      'maps state "%s" to label "%s"',
      async (expectedState, expectedLabel) => {
        // For each state, we need a different init setup
        if (expectedState === 'disabled') {
          setupDisabledMocks();
          await plugin.init(context);
        } else if (expectedState === 'unavailable') {
          // Node.js not found
          mockBunFile.mockReturnValue({
            exists: () => Promise.resolve(true),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  enabled: true,
                  port: 1880,
                  userDir: '~/.slashbot/nodered',
                  healthCheckInterval: 30,
                  shutdownTimeout: 10,
                  maxRestartAttempts: 3,
                  localhostOnly: true,
                }),
              ),
          });
          mockBunSpawn.mockReturnValueOnce({
            exited: Promise.resolve(1),
            pid: 1234,
            kill: vi.fn(),
          });
          await plugin.init(context);
        } else if (expectedState === 'stopped') {
          setupInitMocks();
          // Provide spawn mock for auto-start
          const { process: stopProc } = createMockProcess();
          mockBunSpawn.mockReturnValueOnce(stopProc);
          mockBunWrite.mockResolvedValue(undefined);
          await plugin.init(context);
          const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
          await manager.stop();
        } else if (expectedState === 'starting') {
          setupInitMocks();
          const { process: mockProcess } = createMockProcess();
          mockBunSpawn.mockReturnValueOnce(mockProcess);
          mockBunWrite.mockResolvedValue(undefined);
          await plugin.init(context);
        } else if (expectedState === 'running') {
          setupInitMocks();
          const { process: mockProcess } = createMockProcess();
          mockBunSpawn.mockReturnValueOnce(mockProcess);
          mockBunWrite.mockResolvedValue(undefined);
          mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
          await plugin.init(context);
          await vi.advanceTimersByTimeAsync(500);
        } else if (expectedState === 'failed') {
          setupInitMocks();
          mockBunSpawn.mockImplementationOnce(() => {
            throw new Error('Spawn failed');
          });
          await plugin.init(context);
        }

        const contributions = plugin.getSidebarContributions();
        const manager = container.get<NodeRedManager>(TYPES.NodeRedManager);
        expect(manager.getState()).toBe(expectedState);
        expect(contributions[0].label).toBe(expectedLabel);
      },
    );
  });
});
