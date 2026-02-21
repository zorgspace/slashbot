/**
 * @module plugins/core-ops
 *
 * Core operations plugin providing essential control-plane commands for system
 * health, diagnostics, help display, history management, plugin management,
 * and self-update capabilities. Also includes a startup hook for automatic
 * update checking on bundled installs.
 *
 * Commands: /health, /doctor, /help, /clear, /history, /plugins, /update
 *
 * @see {@link createCoreOpsPlugin} -- Plugin factory function
 */
import type { PathResolver, SlashbotPlugin } from '../../plugin-sdk/index.js';
import { handlePluginsCommand } from './config-tools.js';
import { handleHealthCommand, handleDoctorCommand, handleHelpCommand, handleHealthGateway } from './status-tools.js';
import { handleClearCommand, handleHistoryCommand, handleUpdateCommand, handleAutoUpdateStartup, setUpdateStatePath } from './commands.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'history:clear': Record<string, never>;
  }
}

/**
 * Create the Core Ops plugin.
 *
 * Registers essential control-plane commands:
 *  - `/health`  -- Print runtime health summary.
 *  - `/doctor`  -- Print plugin diagnostics and failures.
 *  - `/help`    -- List all registered commands and tools with usage hints.
 *  - `/clear`   -- Clear conversation history.
 *  - `/history` -- Show session history guidance.
 *  - `/plugins` -- List, install, or remove external plugins.
 *  - `/update`  -- Self-update from git checkout or npm bundled install.
 *
 * Hooks:
 *  - `core.auto-update.startup` -- Background update check on startup (bundled installs only).
 *
 * Gateway methods:
 *  - `core.health` -- Returns kernel health via RPC.
 *
 * @returns A SlashbotPlugin instance with core operations commands, hooks, and gateway methods.
 */
export function createCoreOpsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: 'slashbot.core.ops',
      name: 'Slashbot Core Ops',
      version: '0.1.0',
      main: 'bundled',
      description: 'Health, doctor, help, clear, history, plugins and control plane operations'
    },
    setup: (context) => {
      const paths = context.getService<PathResolver>('kernel.paths')!;
      setUpdateStatePath(paths.home('update-state.json'));

      context.registerCommand({
        id: 'health',
        pluginId: 'slashbot.core.ops',
        description: 'Print runtime health summary',
        execute: handleHealthCommand(context)
      });

      context.registerCommand({
        id: 'doctor',
        pluginId: 'slashbot.core.ops',
        description: 'Print plugin diagnostics and failures',
        execute: handleDoctorCommand(context)
      });

      context.registerCommand({
        id: 'help',
        pluginId: 'slashbot.core.ops',
        description: 'List all available commands and tools',
        execute: handleHelpCommand(context)
      });

      context.registerCommand({
        id: 'clear',
        pluginId: 'slashbot.core.ops',
        description: 'Clear the conversation history',
        execute: handleClearCommand(context)
      });

      context.registerCommand({
        id: 'history',
        pluginId: 'slashbot.core.ops',
        description: 'Show the current session history summary',
        execute: handleHistoryCommand()
      });

      context.registerCommand({
        id: 'plugins',
        pluginId: 'slashbot.core.ops',
        description: 'List, install, or remove external plugins',
        subcommands: ['list', 'install', 'remove'],
        execute: handlePluginsCommand(context, paths)
      });

      context.registerCommand({
        id: 'update',
        pluginId: 'slashbot.core.ops',
        description: 'Update Slashbot for checkout and bundled installs',
        execute: handleUpdateCommand()
      });

      context.registerHook({
        id: 'core.auto-update.startup',
        pluginId: 'slashbot.core.ops',
        domain: 'kernel',
        event: 'startup',
        priority: 90,
        handler: handleAutoUpdateStartup(context)
      });

      context.registerGatewayMethod({
        id: 'core.health',
        pluginId: 'slashbot.core.ops',
        description: 'Returns kernel health object',
        handler: handleHealthGateway(context)
      });
    }
  };
}

/** Alias for {@link createCoreOpsPlugin} conforming to the bundled plugin loader convention. */
export { createCoreOpsPlugin as createPlugin };
