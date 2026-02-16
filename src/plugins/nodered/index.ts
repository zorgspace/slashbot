/**
 * Node-RED Plugin — Managed Node-RED runtime lifecycle
 *
 * Thin plugin wrapper around NodeRedManager service.
 * Handles service registration, status indicator, prompt contribution,
 * and commands (start, stop, restart, status, config).
 */

import { z } from 'zod';
import type {
  IndicatorStatus,
  JsonValue,
  PathResolver,
  SlashbotPlugin,
  StructuredLogger,
} from '../../core/kernel/contracts.js';
import type { EventBus } from '../../core/kernel/event-bus.js';
import { NodeRedManager } from './services/NodeRedManager.js';
import { NODERED_PROMPT } from './prompt.js';
import type { NodeRedState } from './types.js';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'nodered:status': { status: string; port?: number; error?: string };
  }
}

const PLUGIN_ID = 'slashbot.nodered';

/** Config keys that can be updated via /nodered config <key> <value> */
const UPDATABLE_CONFIG_KEYS = ['port', 'healthCheckInterval', 'shutdownTimeout', 'maxRestartAttempts'] as const;

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

/**
 * Map NodeRedState to IndicatorStatus for the status indicator.
 */
const STATE_TO_INDICATOR: Record<NodeRedState, IndicatorStatus> = {
  disabled: 'off',
  unavailable: 'disconnected',
  stopped: 'idle',
  starting: 'busy',
  running: 'running',
  failed: 'error',
};

export function createNodeRedPlugin(): SlashbotPlugin {
  let manager: NodeRedManager;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Node-RED',
      version: '1.0.0',
      main: 'bundled',
      description: 'Managed Node-RED runtime lifecycle',
    },
    setup: (context) => {
      const paths = context.getService<PathResolver>('kernel.paths');
      const events = context.getService<EventBus>('kernel.events');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;

      if (!paths) {
        logger.error('Node-RED plugin: PathResolver not available, skipping');
        return;
      }

      manager = new NodeRedManager(events, logger, paths);

      // Register service
      context.registerService({
        id: 'nodered.manager',
        pluginId: PLUGIN_ID,
        description: 'Node-RED lifecycle manager',
        implementation: manager,
      });

      // Status indicator
      const updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.nodered',
        pluginId: PLUGIN_ID,
        label: 'Node-RED',
        kind: 'service',
        priority: 25,
        statusEvent: 'nodered:status',
        showActivity: true,
        connectorName: 'nodered',
        getInitialStatus: () => STATE_TO_INDICATOR[manager.getState()] ?? 'off',
      });
      manager.setIndicatorUpdater(updateIndicatorStatus);

      // ── Tools ─────────────────────────────────────────────────────────

      context.registerTool({
        id: 'nodered.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get Node-RED runtime status (state, pid, port, uptime, recent logs). Args: {}',
        parameters: z.object({}),
        execute: async () => {
          const status = manager.getStatus(20);
          return {
            ok: true,
            output: {
              state: status.state,
              pid: status.pid,
              port: status.port,
              uptime: status.uptime !== null ? formatUptime(status.uptime) : null,
              restartCount: status.restartCount,
              recentLogs: status.recentLogs,
            } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'nodered.start',
        title: 'Start',
        pluginId: PLUGIN_ID,
        description: 'Start the Node-RED instance. Args: {}',
        parameters: z.object({}),
        execute: async () => {
          if (manager.getState() === 'disabled') {
            await manager.init();
          }
          const result = await manager.start();
          if (result.success) {
            return { ok: true, output: result.message ?? 'Node-RED is starting' };
          }
          return { ok: false, error: { code: 'START_ERROR', message: result.error ?? 'Failed to start' } };
        },
      });

      context.registerTool({
        id: 'nodered.stop',
        title: 'Stop',
        pluginId: PLUGIN_ID,
        description: 'Stop the Node-RED instance. Args: {}',
        parameters: z.object({}),
        execute: async () => {
          const state = manager.getState();
          if (state === 'stopped' || state === 'disabled') {
            return { ok: true, output: 'Node-RED is not running' };
          }
          await manager.stop();
          return { ok: true, output: 'Node-RED stopped' };
        },
      });

      context.registerTool({
        id: 'nodered.restart',
        title: 'Restart',
        pluginId: PLUGIN_ID,
        description: 'Restart the Node-RED instance (stop then start). Args: {}',
        parameters: z.object({}),
        execute: async () => {
          if (manager.getState() === 'disabled') {
            await manager.init();
          }
          await manager.restart();
          return { ok: true, output: 'Node-RED restarting' };
        },
      });

      context.registerTool({
        id: 'nodered.config',
        title: 'Config',
        pluginId: PLUGIN_ID,
        description: 'View or update Node-RED configuration. Args: { port?: number, healthCheckInterval?: number, shutdownTimeout?: number, maxRestartAttempts?: number }',
        parameters: z.object({
          port: z.number().int().positive().optional().describe('HTTP port for Node-RED'),
          healthCheckInterval: z.number().int().positive().optional().describe('Health check interval in seconds'),
          shutdownTimeout: z.number().int().positive().optional().describe('Graceful shutdown timeout in seconds'),
          maxRestartAttempts: z.number().int().nonnegative().optional().describe('Max auto-restart attempts on crash'),
        }),
        execute: async (rawArgs) => {
          const args = rawArgs as Record<string, JsonValue>;
          const updates: Record<string, number> = {};
          for (const key of UPDATABLE_CONFIG_KEYS) {
            if (typeof args[key] === 'number') {
              updates[key] = args[key] as number;
            }
          }

          if (Object.keys(updates).length > 0) {
            await manager.saveConfig(updates);
            return { ok: true, output: `Config updated: ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')}. Restart Node-RED for changes to take effect.` };
          }

          const config = manager.getConfig();
          return {
            ok: true,
            output: {
              enabled: config.enabled,
              port: config.port,
              healthCheckInterval: config.healthCheckInterval,
              shutdownTimeout: config.shutdownTimeout,
              maxRestartAttempts: config.maxRestartAttempts,
              localhostOnly: config.localhostOnly,
              userDir: config.userDir,
            } as unknown as JsonValue,
          };
        },
      });

      // Prompt section
      context.contributePromptSection({
        id: 'nodered.docs',
        pluginId: PLUGIN_ID,
        priority: 160,
        content: NODERED_PROMPT,
      });

      // Command: /nodered (alias /nr via subcommands)
      context.registerCommand({
        id: 'nodered',
        pluginId: PLUGIN_ID,
        description: 'Manage the Node-RED instance (start, stop, restart, status, config)',
        subcommands: ['start', 'stop', 'restart', 'status', 'config'],
        execute: async (args, commandContext) => {
          const sub = args[0]?.toLowerCase();

          // Default: show status
          if (!sub || sub === 'status' || sub === 's') {
            const status = manager.getStatus(20);
            const lines = [
              '',
              '  Node-RED Status',
              '',
              '  State:      ' + status.state,
              '  PID:        ' + (status.pid ?? 'N/A'),
              '  Port:       ' + (status.port ?? 'N/A'),
              '  Uptime:     ' + formatUptime(status.uptime),
              '  Restarts:   ' + status.restartCount,
            ];

            if (status.recentLogs.length > 0) {
              lines.push('', '  Recent logs:');
              for (const line of status.recentLogs) {
                lines.push('    ' + line);
              }
            } else {
              lines.push('', '  No recent logs');
            }
            lines.push('');

            commandContext.stdout.write(lines.join('\n') + '\n');
            return 0;
          }

          // Start
          if (sub === 'start') {
            const result = await manager.start();
            const config = manager.getConfig();

            if (result.success) {
              commandContext.stdout.write(`Starting Node-RED on port ${config.port}...\n`);
            } else {
              commandContext.stderr.write(`${result.error || 'Failed to start Node-RED'}\n`);
              return 1;
            }
            return 0;
          }

          // Stop
          if (sub === 'stop') {
            const state = manager.getState();
            if (state === 'stopped' || state === 'disabled') {
              commandContext.stdout.write('Node-RED is not running.\n');
              return 0;
            }

            await manager.stop();
            commandContext.stdout.write('Node-RED stopped.\n');
            return 0;
          }

          // Restart
          if (sub === 'restart') {
            await manager.restart();
            commandContext.stdout.write('Restarting Node-RED...\n');
            return 0;
          }

          // Config
          if (sub === 'config') {
            const key = args[1];
            const value = args[2];

            // No key: display current config
            if (!key) {
              const config = manager.getConfig();
              const lines = [
                '',
                '  Node-RED Configuration',
                '',
                '  enabled:              ' + config.enabled,
                '  port:                 ' + config.port,
                '  healthCheckInterval:  ' + config.healthCheckInterval + 's',
                '  shutdownTimeout:      ' + config.shutdownTimeout + 's',
                '  maxRestartAttempts:   ' + config.maxRestartAttempts,
                '  localhostOnly:        ' + config.localhostOnly,
                '  userDir:              ' + config.userDir,
                '',
              ];
              commandContext.stdout.write(lines.join('\n') + '\n');
              return 0;
            }

            // Key without value: show usage
            if (!value) {
              commandContext.stderr.write('Usage: /nodered config <key> <value>\n');
              return 1;
            }

            // Validate key
            if (!(UPDATABLE_CONFIG_KEYS as readonly string[]).includes(key)) {
              commandContext.stderr.write(`Unknown config key: ${key}. Supported: ${UPDATABLE_CONFIG_KEYS.join(', ')}\n`);
              return 1;
            }

            // Parse numeric value
            const numericValue = Number(value);
            if (isNaN(numericValue) || numericValue <= 0) {
              commandContext.stderr.write(`Invalid value for ${key}: must be a positive number\n`);
              return 1;
            }

            await manager.saveConfig({ [key]: numericValue });
            commandContext.stdout.write(`Updated ${key} = ${numericValue}\nNote: restart Node-RED for changes to take effect\n`);
            return 0;
          }

          // Unknown subcommand - show help
          const helpLines = [
            '',
            '  Node-RED Commands',
            '',
            '  /nodered status     Show status and recent logs',
            '  /nodered start      Start Node-RED',
            '  /nodered stop       Stop Node-RED',
            '  /nodered restart    Restart Node-RED',
            '  /nodered config     Show/update configuration',
            '',
            '  Alias: /nr',
            '',
          ];
          commandContext.stdout.write(helpLines.join('\n') + '\n');
          return 0;
        },
      });

      // Startup hook: init + auto-start
      context.registerHook({
        id: 'nodered.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 70,
        handler: async () => {
          await manager.init();

          // Auto-start if enabled and Node.js available
          const config = manager.getConfig();
          const state = manager.getState();
          if (config.enabled && state !== 'unavailable' && state !== 'disabled') {
            await manager.start();
          }
        },
      });

      // Shutdown hook
      context.registerHook({
        id: 'nodered.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 70,
        handler: async () => {
          await manager.destroy();
        },
      });
    },
  };
}

export { createNodeRedPlugin as createPlugin };
