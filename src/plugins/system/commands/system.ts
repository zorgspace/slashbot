/**
 * System Commands - help, clear, history, exit, banner
 */

import { display } from '../../../core/ui';
import { fg, bold } from '@opentui/core';
import { theme } from '../../../core/ui/theme';
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

    display.append(
      `${fg(theme.accent)(bold('Keyboard shortcuts:'))}\n\n  ?           Show this help\n  Ctrl+C      Cancel / Quit\n\n`,
    );
    display.append(`${fg(theme.accent)(bold('Commands:'))}\n\n`);

    const groupMap = new Map<string, CommandHandler[]>();
    const seen = new Set<string>();
    for (const handler of commands.values()) {
      if (seen.has(handler.name)) continue;
      seen.add(handler.name);
      const group = handler.group || 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(handler);
    }

    let commandsText = '';
    for (const [groupTitle, handlers] of groupMap) {
      if (groupTitle !== 'Other') {
        commandsText += `${fg(theme.primary)(groupTitle)}\n`;
      }
      for (const cmd of handlers) {
        commandsText += `  /${cmd.name.padEnd(10)} ${cmd.description}\n`;
      }
      commandsText += '\n';
    }

    display.append(commandsText);
    display.append(`${fg(theme.muted)('Use /help <command> for more details')}\n\n`);
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

      const historyBlock = `${fg(theme.accent)('Command history:')}\n\n${recent.map((line, i) => fg(theme.muted)('  ' + String(lines.length - recent.length + i + 1).padStart(4) + '  ' + line)).join('\n')}\n`;
      display.append(historyBlock);
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
    display.append(`${fg(theme.accent)('Goodbye!')}\n\n`);
    process.exit(0);
  },
};

export const bannerCommand: CommandHandler = {
  name: 'banner',
  description: 'Display the Slashbot banner',
  usage: '/banner',
  group: 'System',
  execute: async (_, context) => {
    let tasksCount = 0;
    let heartbeatStatus: { running: boolean; enabled: boolean } | undefined;
    try {
      const { TYPES } = await import('../../../core/di/types');
      const hbService = context.container.get<any>(TYPES.HeartbeatService);
      heartbeatStatus = hbService?.getStatus();
      const agentService = context.container.get<any>(TYPES.AgentOrchestratorService);
      const summary = agentService?.getSummary?.();
      if (summary) {
        tasksCount = Number(summary.queued || 0) + Number(summary.running || 0);
      }
    } catch {
      // Optional services not bound
    }
    const cfg = context.configManager.getConfig();
    const voiceEnabled = !!(cfg.providers?.openai?.apiKey || process.env.OPENAI_API_KEY);
    const walletUnlocked = isSessionActive();

    const pkg = await import('../../../../package.json');
const bannerText = `${fg(theme.primary)('Slashbot v' + pkg.version)}
${fg(theme.muted)('Working directory: ' + context.codeEditor.getWorkDir())}
${fg(theme.muted)('Tasks: ' + tasksCount)}
${fg(theme.muted)('Telegram: ' + (context.connectors.has('telegram') ? fg(theme.success)('connected') : 'off'))}
${fg(theme.muted)('Discord: ' + (context.connectors.has('discord') ? fg(theme.success)('connected') : 'off'))}
${fg(theme.muted)('Voice: ' + (voiceEnabled ? fg(theme.success)('enabled') : 'off'))}
${fg(theme.muted)('Heartbeat: ' + (heartbeatStatus?.running && heartbeatStatus.enabled ? fg(theme.success)('active') : 'off'))}
${fg(theme.muted)('Wallet: ' + (walletUnlocked ? fg(theme.success)('unlocked') : 'locked'))}
`;
    display.append(bannerText);

    return true;
  },
};
