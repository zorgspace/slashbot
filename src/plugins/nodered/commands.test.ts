import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import type { CommandContext } from '../../core/commands/registry';
import type { NodeRedManager } from './services/NodeRedManager';
import type { NodeRedStatus } from './types';

// Mock the display service
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

import { display } from '../../core/ui';
import { noderedCommands, noderedHandler } from './commands';
import { TYPES } from '../../core/di/types';

describe('Node-RED Commands', () => {
  let mockManager: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
    saveConfig: ReturnType<typeof vi.fn>;
  };
  let mockContext: CommandContext;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockManager = {
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      getState: vi.fn().mockReturnValue('running'),
      getStatus: vi.fn().mockReturnValue({
        state: 'running',
        pid: 12345,
        port: 1880,
        uptime: 3600,
        restartCount: 0,
        recentLogs: ['[12:30:01] Node-RED started', '[12:30:05] Flows started'],
      } as NodeRedStatus),
      getConfig: vi.fn().mockReturnValue({
        enabled: true,
        port: 1880,
        userDir: '~/.slashbot/nodered',
        healthCheckInterval: 30,
        shutdownTimeout: 10,
        maxRestartAttempts: 3,
        localhostOnly: true,
      }),
      saveConfig: vi.fn().mockResolvedValue(undefined),
    };

    mockGet = vi.fn().mockReturnValue(mockManager);
    mockContext = {
      container: {
        get: mockGet,
      },
    } as any;
  });

  describe('command metadata', () => {
    it('has correct name', () => {
      expect(noderedHandler.name).toBe('nodered');
    });

    it('has alias nr', () => {
      expect(noderedHandler.aliases).toContain('nr');
    });

    it('has description', () => {
      expect(noderedHandler.description).toBeTruthy();
    });

    it('has usage string', () => {
      expect(noderedHandler.usage).toContain('/nodered');
    });

    it('has subcommands for tab completion', () => {
      expect(noderedHandler.subcommands).toContain('start');
      expect(noderedHandler.subcommands).toContain('stop');
      expect(noderedHandler.subcommands).toContain('restart');
      expect(noderedHandler.subcommands).toContain('status');
      expect(noderedHandler.subcommands).toContain('config');
    });

    it('exports commands array', () => {
      expect(noderedCommands).toBeInstanceOf(Array);
      expect(noderedCommands).toHaveLength(1);
      expect(noderedCommands[0]).toBe(noderedHandler);
    });
  });

  describe('service resolution', () => {
    it('resolves NodeRedManager from DI container', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(mockGet).toHaveBeenCalledWith(TYPES.NodeRedManager);
    });

    it('shows error when NodeRedManager is not available', async () => {
      mockGet.mockImplementation(() => {
        throw new Error('Not bound');
      });

      const result = await noderedHandler.execute(['status'], mockContext);

      expect(result).toBe(true);
      expect(display.errorText).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
    });
  });

  describe('/nodered start', () => {
    it('calls manager.start()', async () => {
      mockManager.start.mockResolvedValue({ success: true, message: 'Node-RED is starting' });
      mockManager.getConfig.mockReturnValue({ port: 1880 });

      await noderedHandler.execute(['start'], mockContext);

      expect(mockManager.start).toHaveBeenCalled();
    });

    it('shows success message with port', async () => {
      mockManager.start.mockResolvedValue({ success: true, message: 'Node-RED is starting' });
      mockManager.getConfig.mockReturnValue({ port: 1880 });

      await noderedHandler.execute(['start'], mockContext);

      expect(display.successText).toHaveBeenCalledWith(
        expect.stringContaining('1880'),
      );
    });

    it('shows info when already running (idempotent)', async () => {
      mockManager.start.mockResolvedValue({ success: true, message: 'Node-RED is already running' });
      mockManager.getConfig.mockReturnValue({ port: 1880 });

      await noderedHandler.execute(['start'], mockContext);

      // Should still show a message, not error
      expect(display.errorText).not.toHaveBeenCalled();
    });

    it('shows error when start fails', async () => {
      mockManager.start.mockResolvedValue({ success: false, error: 'Cannot start Node-RED in unavailable state' });

      await noderedHandler.execute(['start'], mockContext);

      expect(display.errorText).toHaveBeenCalledWith(
        expect.stringContaining('Cannot start'),
      );
    });
  });

  describe('/nodered stop', () => {
    it('calls manager.stop()', async () => {
      mockManager.getState.mockReturnValue('running');

      await noderedHandler.execute(['stop'], mockContext);

      expect(mockManager.stop).toHaveBeenCalled();
    });

    it('shows success message after stop', async () => {
      mockManager.getState.mockReturnValue('running');

      await noderedHandler.execute(['stop'], mockContext);

      expect(display.successText).toHaveBeenCalledWith(
        expect.stringContaining('stopped'),
      );
    });

    it('shows info when already stopped (idempotent)', async () => {
      mockManager.getState.mockReturnValue('stopped');

      await noderedHandler.execute(['stop'], mockContext);

      // Should show info, not error
      expect(display.muted).toHaveBeenCalledWith(
        expect.stringContaining('not running'),
      );
    });
  });

  describe('/nodered restart', () => {
    it('calls manager.restart()', async () => {
      await noderedHandler.execute(['restart'], mockContext);

      expect(mockManager.restart).toHaveBeenCalled();
    });

    it('shows restarting message', async () => {
      await noderedHandler.execute(['restart'], mockContext);

      expect(display.successText).toHaveBeenCalledWith(
        expect.stringContaining('estarting'),
      );
    });
  });

  describe('/nodered status', () => {
    it('calls manager.getStatus(20)', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(mockManager.getStatus).toHaveBeenCalledWith(20);
    });

    it('displays state', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('running'),
      );
    });

    it('displays PID', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('12345'),
      );
    });

    it('displays port', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('1880'),
      );
    });

    it('displays uptime formatted', async () => {
      await noderedHandler.execute(['status'], mockContext);

      // 3600 seconds = 1h 0m
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('1h'),
      );
    });

    it('displays restart count', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('0'),
      );
    });

    it('displays recent logs', async () => {
      await noderedHandler.execute(['status'], mockContext);

      expect(display.muted).toHaveBeenCalledWith(
        expect.stringContaining('Node-RED started'),
      );
    });

    it('handles null uptime (not running)', async () => {
      mockManager.getStatus.mockReturnValue({
        state: 'stopped',
        pid: null,
        port: null,
        uptime: null,
        restartCount: 0,
        recentLogs: [],
      } as NodeRedStatus);

      await noderedHandler.execute(['status'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('N/A'),
      );
    });

    it('handles empty logs', async () => {
      mockManager.getStatus.mockReturnValue({
        state: 'stopped',
        pid: null,
        port: null,
        uptime: null,
        restartCount: 0,
        recentLogs: [],
      } as NodeRedStatus);

      const result = await noderedHandler.execute(['status'], mockContext);

      expect(result).toBe(true);
      // Should not throw, just show "No recent logs"
    });
  });

  describe('unknown subcommand', () => {
    it('shows usage help for unknown subcommand', async () => {
      await noderedHandler.execute(['foobar'], mockContext);

      expect(display.violet).toHaveBeenCalledWith(
        expect.stringContaining('Node-RED Commands'),
      );
    });

    it('lists available subcommands in help', async () => {
      await noderedHandler.execute(['unknown'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('/nodered start'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('/nodered stop'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('/nodered restart'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('/nodered status'),
      );
    });
  });

  describe('no subcommand (default)', () => {
    it('shows status by default when no args', async () => {
      await noderedHandler.execute([], mockContext);

      expect(mockManager.getStatus).toHaveBeenCalledWith(20);
    });
  });

  describe('/nodered with alias /nr', () => {
    it('aliases field contains nr', () => {
      expect(noderedHandler.aliases).toEqual(['nr']);
    });
  });

  describe('/nodered config', () => {
    it('displays current config when no args', async () => {
      await noderedHandler.execute(['config'], mockContext);

      expect(mockManager.getConfig).toHaveBeenCalled();
      expect(display.violet).toHaveBeenCalledWith(
        expect.stringContaining('Configuration'),
      );
    });

    it('displays all config values', async () => {
      await noderedHandler.execute(['config'], mockContext);

      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('1880'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('30'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('10'),
      );
      expect(display.append).toHaveBeenCalledWith(
        expect.stringContaining('3'),
      );
    });

    it('updates port config value', async () => {
      await noderedHandler.execute(['config', 'port', '3000'], mockContext);

      expect(mockManager.saveConfig).toHaveBeenCalledWith({ port: 3000 });
    });

    it('updates healthCheckInterval config value', async () => {
      await noderedHandler.execute(['config', 'healthCheckInterval', '60'], mockContext);

      expect(mockManager.saveConfig).toHaveBeenCalledWith({ healthCheckInterval: 60 });
    });

    it('updates shutdownTimeout config value', async () => {
      await noderedHandler.execute(['config', 'shutdownTimeout', '15'], mockContext);

      expect(mockManager.saveConfig).toHaveBeenCalledWith({ shutdownTimeout: 15 });
    });

    it('updates maxRestartAttempts config value', async () => {
      await noderedHandler.execute(['config', 'maxRestartAttempts', '5'], mockContext);

      expect(mockManager.saveConfig).toHaveBeenCalledWith({ maxRestartAttempts: 5 });
    });

    it('shows confirmation message after updating config', async () => {
      await noderedHandler.execute(['config', 'port', '3000'], mockContext);

      expect(display.successText).toHaveBeenCalledWith(
        expect.stringContaining('port'),
      );
    });

    it('shows restart notice after updating config', async () => {
      await noderedHandler.execute(['config', 'port', '3000'], mockContext);

      // Should mention restart may be required
      expect(display.muted).toHaveBeenCalledWith(
        expect.stringContaining('restart'),
      );
    });

    it('rejects unsupported config keys', async () => {
      await noderedHandler.execute(['config', 'unknownKey', 'value'], mockContext);

      expect(mockManager.saveConfig).not.toHaveBeenCalled();
      expect(display.errorText).toHaveBeenCalledWith(
        expect.stringContaining('Unknown'),
      );
    });

    it('shows error for invalid numeric value', async () => {
      await noderedHandler.execute(['config', 'port', 'notanumber'], mockContext);

      expect(mockManager.saveConfig).not.toHaveBeenCalled();
      expect(display.errorText).toHaveBeenCalled();
    });

    it('shows error when value is missing', async () => {
      await noderedHandler.execute(['config', 'port'], mockContext);

      expect(mockManager.saveConfig).not.toHaveBeenCalled();
      expect(display.errorText).toHaveBeenCalledWith(
        expect.stringContaining('Usage'),
      );
    });
  });
});
