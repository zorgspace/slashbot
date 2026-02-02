/**
 * System Command Handlers - help, clear, history, context, usage, exit
 */

import { c } from '../../ui/colors';
import { getLocalHistoryFile } from '../../constants';
import type { CommandHandler, CommandContext } from '../registry';

// Reference to command registry for help command (set by registry)
let commandsRef: Map<string, CommandHandler> | null = null;

export function setCommandsRef(commands: Map<string, CommandHandler>): void {
  commandsRef = commands;
}

export const helpCommand: CommandHandler = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  aliases: ['?'],
  execute: async args => {
    if (!commandsRef) {
      console.log(c.error('Command registry not available'));
      return true;
    }

    if (args.length > 0) {
      const cmd = commandsRef.get(args[0]);
      if (cmd) {
        console.log(`\n${c.violet(cmd.name)} - ${cmd.description}`);
        console.log(`${c.muted('Usage:')} ${cmd.usage}\n`);
      } else {
        console.log(c.error(`Unknown command: ${args[0]}`));
      }
      return true;
    }

    console.log(`\n${c.violet(c.bold('Keyboard shortcuts:'))}\n`);
    console.log(`  ${c.violet('?')}           ${c.muted('Show this help')}`);
    console.log(`  ${c.violet('Ctrl+C')}      ${c.muted('Cancel / Quit')}`);

    console.log(`\n${c.violet(c.bold('Commands:'))}\n`);

    const cmdGroups = [
      { title: 'Session', cmds: ['login', 'logout', 'config'] },
      { title: 'Code', cmds: ['auth', 'init', 'grep', 'files'] },
      { title: 'Tasks', cmds: ['task', 'tasks'] },
      { title: 'Skills', cmds: ['skill', 'skills'] },
      { title: 'Files', cmds: ['read', 'write'] },
      { title: 'API', cmds: ['usage', 'context'] },
      { title: 'Personality', cmds: ['depressed', 'sarcasm', 'normal', 'unhinged'] },
      { title: 'Other', cmds: ['update', 'history', 'clear', 'exit'] },
    ];

    for (const group of cmdGroups) {
      for (const name of group.cmds) {
        const cmd = commandsRef.get(name);
        if (cmd) {
          console.log(`  ${c.violet('/' + name.padEnd(10))} ${c.muted(cmd.description)}`);
        }
      }
    }

    console.log(`\n${c.muted('Use /help <command> for more details')}\n`);
    return true;
  },
};

export const clearCommand: CommandHandler = {
  name: 'clear',
  description: 'Clear conversation history',
  usage: '/clear',
  execute: async (_, context) => {
    context.grokClient?.clearHistory();
    console.clear();
    console.log(c.success('Conversation history cleared'));
    return true;
  },
};

export const historyCommand: CommandHandler = {
  name: 'history',
  description: 'Show command history',
  usage: '/history [n]',
  execute: async args => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);

      if (!(await file.exists())) {
        console.log(c.muted('No history'));
        return true;
      }

      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      const recent = lines.slice(-limit);

      console.log(`\n${c.violet('Command history:')}\n`);
      recent.forEach((line, i) => {
        const num = lines.length - recent.length + i + 1;
        console.log(`  ${c.muted(String(num).padStart(4))}  ${line}`);
      });
      console.log();
    } catch {
      console.log(c.muted('Could not read history'));
    }

    return true;
  },
};

export const exitCommand: CommandHandler = {
  name: 'exit',
  description: 'Quit Slashbot',
  usage: '/exit',
  execute: async (_, context) => {
    console.log(c.violet('\nGoodbye!\n'));
    context.scheduler.stop();
    process.exit(0);
  },
};

export const systemHandlers: CommandHandler[] = [
  helpCommand,
  clearCommand,
  historyCommand,
  exitCommand,
];
