/**
 * @module plugins/core-ops/status-tools
 *
 * Status, health check, diagnostics, and help (brain-dump) handlers for the
 * core-ops plugin.
 */
import type { JsonValue } from '../../plugin-sdk/index.js';
import type { CommandRegistry, ToolRegistry } from '@slashbot/core/kernel/registries.js';

/* ------------------------------------------------------------------ */
/*  Command guide for /help output                                     */
/* ------------------------------------------------------------------ */

const COMMAND_GUIDE: Record<string, { usage: string; when: string }> = {
  health: {
    usage: '/health',
    when: 'Use when you need a quick runtime status check.',
  },
  doctor: {
    usage: '/doctor',
    when: 'Use when behavior is broken and you want plugin failure diagnostics.',
  },
  help: {
    usage: '/help',
    when: 'Use when you need the full command/tool catalog and usage hints.',
  },
  clear: {
    usage: '/clear',
    when: 'Use when you want to reset chat history/context.',
  },
  history: {
    usage: '/history',
    when: 'Use when you want guidance about history handling in the TUI.',
  },
  plugins: {
    usage: '/plugins [list|install <github-url> [name]|remove <name>]',
    when: 'Use to list loaded/available plugins, install from GitHub, or remove an external plugin.',
  },
  update: {
    usage: '/update [--source <npm-or-github-source>]',
    when: 'Use when you want to upgrade Slashbot from bundled or checkout installs.',
  },
wallet: {
    usage: '/wallet <create|import|export|balance|send|redeem|deposit|pricing|mode|usage|unlock|lock|status> [...]',
    when: 'Use when managing the local wallet, balances, transfers, or payment mode.',
  },
  telegram: {
    usage: '/telegram <status|setup|enable|disable|chatid|groupchatid> [...]',
    when: 'Use when configuring Telegram connectivity and authorized chats.',
  },
  discord: {
    usage: '/discord <status|setup> [...]',
    when: 'Use when configuring Discord bot connectivity and channels.',
  },
  heartbeat: {
    usage: '/heartbeat <status|enable|disable|every|trigger> [...]',
    when: 'Use when controlling periodic heartbeat checks and reports.',
  },
  transcription: {
    usage: '/transcription <status|setup> [...]',
    when: 'Use when checking or configuring audio transcription support.',
  },
};

function commandUsage(command: { id: string; subcommands?: string[] }): string {
  const guide = COMMAND_GUIDE[command.id];
  if (guide) return guide.usage;
  if (command.subcommands && command.subcommands.length > 0) {
    return `/${command.id} <${command.subcommands.join('|')}>`;
  }
  return `/${command.id}`;
}

function commandWhenToUse(command: { id: string; description: string }): string {
  const guide = COMMAND_GUIDE[command.id];
  if (guide) return guide.when;
  return command.description;
}

/* ------------------------------------------------------------------ */
/*  Command handlers                                                   */
/* ------------------------------------------------------------------ */

interface StatusContext {
  getService<TService>(serviceId: string): TService | undefined;
}

/**
 * Handler for `/health` -- print runtime health summary.
 */
export function handleHealthCommand(
  context: StatusContext
): (args: string[], commandContext: { stdout: NodeJS.WritableStream }) => Promise<number> {
  return async (_args, commandContext) => {
    const getHealth = context.getService<() => unknown>('kernel.health');
    commandContext.stdout.write(`${JSON.stringify(getHealth ? getHealth() : { status: 'unknown' }, null, 2)}\n`);
    return 0;
  };
}

/**
 * Handler for `/doctor` -- print plugin diagnostics and failures.
 */
export function handleDoctorCommand(
  context: StatusContext
): (args: string[], commandContext: { stdout: NodeJS.WritableStream }) => Promise<number> {
  return async (_args, commandContext) => {
    const getDiagnostics = context.getService<() => unknown>('kernel.diagnostics');
    commandContext.stdout.write(
      `${JSON.stringify(getDiagnostics ? getDiagnostics() : { diagnostics: [] }, null, 2)}\n`
    );
    return 0;
  };
}

/**
 * Handler for `/help` -- list all registered commands and tools.
 */
export function handleHelpCommand(
  context: StatusContext
): (args: string[], commandContext: { stdout: NodeJS.WritableStream }) => Promise<number> {
  return async (_args, commandContext) => {
    const commandsRegistry = context.getService<CommandRegistry>('kernel.commands.registry');
    const toolsRegistry = context.getService<ToolRegistry>('kernel.tools.registry');
    if (!commandsRegistry || !toolsRegistry) {
      commandContext.stdout.write('Kernel registries not available\n');
      return 1;
    }

    const commands = commandsRegistry.list();
    const tools = toolsRegistry.list();

    commandContext.stdout.write('Commands:\n');
    for (const cmd of commands.sort((a, b) => a.id.localeCompare(b.id))) {
      commandContext.stdout.write(`  /${cmd.id} — ${cmd.description}\n`);
      commandContext.stdout.write(`    Usage: ${commandUsage(cmd)}\n`);
      commandContext.stdout.write(`    When to use: ${commandWhenToUse(cmd)}\n`);
    }

    commandContext.stdout.write('\nTools:\n');
    for (const tool of tools.sort((a, b) => a.id.localeCompare(b.id))) {
      commandContext.stdout.write(`  ${tool.id} — ${tool.title ?? tool.description}\n`);
    }

    return 0;
  };
}

/**
 * Gateway handler for `core.health` -- returns kernel health via RPC.
 */
export function handleHealthGateway(
  context: StatusContext
): () => Promise<JsonValue> {
  return async () => {
    const getHealth = context.getService<() => unknown>('kernel.health');
    const value = getHealth ? getHealth() : { status: 'unknown' };
    return value as JsonValue;
  };
}
