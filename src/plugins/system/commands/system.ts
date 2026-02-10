/**
 * System Commands - help, clear, history, exit, banner
 */

import { display } from '../../../core/ui';
import { getLocalHistoryFile } from '../../../core/config/constants';
import { isSessionActive } from '../../wallet/services';
import type { CommandHandler } from '../../../core/commands/registry';

export const helpCommand: CommandHandler = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  aliases: ['?'],
  group: 'System',
  execute: async (args, context) => {
    const { TYPES } = await import('../../../core/di/types');
    const { container } = await import('../../../core/di/container');
    const registry = container.get(TYPES.CommandRegistry) as any;
    const commands: Map<string, CommandHandler> = registry.commands;

    if (!commands) {
      display.errorText('Command registry not available');
      return true;
    }

    if (args.length > 0) {
      const cmd = commands.get(args[0]);
      if (cmd) {
        display.append('');
        display.violet(cmd.name);
        display.muted('Usage: ' + cmd.usage);
        display.append('');
      } else {
        display.errorText('Unknown command: ' + args[0]);
      }
      return true;
    }

    display.append('');
    display.violet('Keyboard shortcuts:', { bold: true });
    display.append('');
    display.append('  ?           Show this help');
    display.append('  Ctrl+C      Cancel / Quit');

    display.append('');
    display.violet('Commands:', { bold: true });
    display.append('');

    const groupMap = new Map<string, CommandHandler[]>();
    const seen = new Set<string>();
    for (const handler of commands.values()) {
      if (seen.has(handler.name)) continue;
      seen.add(handler.name);
      const group = handler.group || 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(handler);
    }

    for (const [groupTitle, handlers] of groupMap) {
      for (const cmd of handlers) {
        display.append('  /' + cmd.name.padEnd(10) + ' ' + cmd.description);
      }
    }

    display.append('');
    display.muted('Use /help <command> for more details');
    display.append('');
    return true;
  },
};

export const clearCommand: CommandHandler = {
  name: 'clear',
  description: 'Clear conversation history',
  usage: '/clear',
  group: 'System',
  execute: async (_, context) => {
    context.grokClient?.clearHistory();
    if (context.tuiApp) {
      context.tuiApp.clearChat();
      context.tuiApp.clearDiffPanel();
    } else {
      console.clear();
    }
    display.successText('Conversation history cleared');
    return true;
  },
};

export const historyCommand: CommandHandler = {
  name: 'history',
  description: 'Show command history',
  usage: '/history [n]',
  group: 'System',
  execute: async args => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);

      if (!(await file.exists())) {
        display.muted('No history');
        return true;
      }

      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      const recent = lines.slice(-limit);

      display.append('');
      display.violet('Command history:');
      display.append('');
      recent.forEach((line, i) => {
        const num = lines.length - recent.length + i + 1;
        display.muted('  ' + String(num).padStart(4) + '  ' + line);
      });
      display.append('');
    } catch {
      display.muted('Could not read history');
    }

    return true;
  },
};

export const exitCommand: CommandHandler = {
  name: 'exit',
  description: 'Quit Slashbot',
  usage: '/exit',
  group: 'System',
  execute: async (_, context) => {
    display.append('');
    display.violet('Goodbye!');
    display.append('');
    context.scheduler.stop();
    process.exit(0);
  },
};

export const bannerCommand: CommandHandler = {
  name: 'banner',
  description: 'Display the Slashbot banner',
  usage: '/banner',
  group: 'System',
  execute: async (_, context) => {
    const tasks = context.scheduler.listTasks();
    let heartbeatStatus: { running: boolean; enabled: boolean } | undefined;
    try {
      const { TYPES } = await import('../../../core/di/types');
      const hbService = context.container.get<any>(TYPES.HeartbeatService);
      heartbeatStatus = hbService?.getStatus();
    } catch {
      // HeartbeatService not bound
    }
    const cfg = context.configManager.getConfig();
    const voiceEnabled = !!(cfg.providers?.openai?.apiKey || process.env.OPENAI_API_KEY);
    const walletUnlocked = isSessionActive();

    const pkg = await import('../../../../package.json');
    display.append('Slashbot v' + pkg.version);
    display.muted('Working directory: ' + context.codeEditor.getWorkDir());
    display.muted('Tasks: ' + tasks.length);
    display.muted('Telegram: ' + (context.connectors.has('telegram') ? 'connected' : 'off'));
    display.muted('Discord: ' + (context.connectors.has('discord') ? 'connected' : 'off'));
    display.muted('Voice: ' + (voiceEnabled ? 'enabled' : 'off'));
    display.muted(
      'Heartbeat: ' + (heartbeatStatus?.running && heartbeatStatus.enabled ? 'active' : 'off'),
    );
    display.muted('Wallet: ' + (walletUnlocked ? 'unlocked' : 'locked'));

    return true;
  },
};
