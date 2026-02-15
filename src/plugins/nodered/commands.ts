/**
 * Node-RED Lifecycle Commands
 *
 * Command handler for /nodered (alias /nr) with subcommands:
 * start, stop, restart, status, config
 *
 * @see /specs/001-nodered-lifecycle/contracts/nodered-commands.ts
 */

import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import type { NodeRedManager } from './services/NodeRedManager';

/**
 * Format uptime seconds into human-readable string (e.g., "2h 15m")
 */
function formatUptime(seconds: number | null): string {
  if (seconds === null) return 'N/A';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Config keys that can be updated via /nodered config <key> <value> */
const UPDATABLE_CONFIG_KEYS = ['port', 'healthCheckInterval', 'shutdownTimeout', 'maxRestartAttempts'] as const;

export const noderedHandler: CommandHandler = {
  name: 'nodered',
  aliases: ['nr'],
  description: 'Manage the Node-RED instance',
  usage: '/nodered <start|stop|restart|status|config> [args]',
  group: 'Node-RED',
  subcommands: ['start', 'stop', 'restart', 'status', 'config'],

  async execute(args: string[], context: CommandContext): Promise<boolean> {
    let manager: NodeRedManager;
    try {
      manager = context.container.get<NodeRedManager>(TYPES.NodeRedManager);
    } catch {
      display.errorText('  Node-RED service not available');
      return true;
    }

    const subcommand = args[0]?.toLowerCase();

    // Default: show status
    if (!subcommand || subcommand === 'status' || subcommand === 's') {
      const status = manager.getStatus(20);

      display.append('');
      display.violet('  Node-RED Status');
      display.append('');
      display.append('  State:      ' + status.state);
      display.append('  PID:        ' + (status.pid ?? 'N/A'));
      display.append('  Port:       ' + (status.port ?? 'N/A'));
      display.append('  Uptime:     ' + formatUptime(status.uptime));
      display.append('  Restarts:   ' + status.restartCount);

      if (status.recentLogs.length > 0) {
        display.append('');
        display.muted('  Recent logs:');
        for (const line of status.recentLogs) {
          display.muted('    ' + line);
        }
      } else {
        display.append('');
        display.muted('  No recent logs');
      }

      display.append('');
      return true;
    }

    // Start
    if (subcommand === 'start') {
      const result = await manager.start();
      const config = manager.getConfig();

      if (result.success) {
        display.successText('  Starting Node-RED on port ' + config.port + '...');
      } else {
        display.errorText('  ' + (result.error || 'Failed to start Node-RED'));
      }
      return true;
    }

    // Stop
    if (subcommand === 'stop') {
      const state = manager.getState();

      if (state === 'stopped' || state === 'disabled') {
        display.muted('  Node-RED is not running.');
        return true;
      }

      await manager.stop();
      display.successText('  Node-RED stopped.');
      return true;
    }

    // Restart
    if (subcommand === 'restart') {
      await manager.restart();
      display.successText('  Restarting Node-RED...');
      return true;
    }

    // Config
    if (subcommand === 'config') {
      const key = args[1];
      const value = args[2];

      // No key: display current config
      if (!key) {
        const config = manager.getConfig();

        display.append('');
        display.violet('  Node-RED Configuration');
        display.append('');
        display.append('  enabled:              ' + config.enabled);
        display.append('  port:                 ' + config.port);
        display.append('  healthCheckInterval:  ' + config.healthCheckInterval + 's');
        display.append('  shutdownTimeout:      ' + config.shutdownTimeout + 's');
        display.append('  maxRestartAttempts:   ' + config.maxRestartAttempts);
        display.append('  localhostOnly:        ' + config.localhostOnly);
        display.append('  userDir:              ' + config.userDir);
        display.append('');
        return true;
      }

      // Key without value: show usage
      if (!value) {
        display.errorText('  Usage: /nodered config <key> <value>');
        return true;
      }

      // Validate key
      if (!(UPDATABLE_CONFIG_KEYS as readonly string[]).includes(key)) {
        display.errorText('  Unknown config key: ' + key + '. Supported: ' + UPDATABLE_CONFIG_KEYS.join(', '));
        return true;
      }

      // Parse numeric value
      const numericValue = Number(value);
      if (isNaN(numericValue) || numericValue <= 0) {
        display.errorText('  Invalid value for ' + key + ': must be a positive number');
        return true;
      }

      await manager.saveConfig({ [key]: numericValue });
      display.successText('  Updated ' + key + ' = ' + numericValue);
      display.muted('  Note: restart Node-RED for changes to take effect');
      display.append('');
      return true;
    }

    // Unknown subcommand - show help
    display.append('');
    display.violet('  Node-RED Commands');
    display.append('');
    display.append('  /nodered status     Show status and recent logs');
    display.append('  /nodered start      Start Node-RED');
    display.append('  /nodered stop       Stop Node-RED');
    display.append('  /nodered restart    Restart Node-RED');
    display.append('  /nodered config     Show/update configuration');
    display.append('');
    display.muted('  Alias: /nr');
    display.append('');

    return true;
  },
};

export const noderedCommands: CommandHandler[] = [noderedHandler];
