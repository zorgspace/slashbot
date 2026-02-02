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
      { title: 'Other', cmds: ['history', 'clear', 'exit'] },
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

export const contextCommand: CommandHandler = {
  name: 'context',
  description: 'Manage context compression',
  usage: '/context [on|off|status] [max_messages]',
  execute: async (args, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const subcommand = args[0] || 'status';

    switch (subcommand) {
      case 'on':
        const maxMsgs = parseInt(args[1]) || 20;
        context.grokClient.setContextCompression(true, maxMsgs);
        console.log(c.success(`Compression enabled (max ${maxMsgs} messages)`));
        break;

      case 'off':
        context.grokClient.setContextCompression(false);
        console.log(c.success('Compression disabled'));
        break;

      case 'status':
      default:
        const enabled = context.grokClient.isContextCompressionEnabled();
        const maxMessages = context.grokClient.getMaxContextMessages();
        const contextSize = context.grokClient.getContextSize();
        const estimatedTokens = context.grokClient.estimateTokens();

        console.log(`\n${c.violet('Context:')}\n`);
        console.log(
          `  ${c.muted('Compression:')}  ${enabled ? c.success('Enabled') : c.warning('Disabled')}`,
        );
        console.log(`  ${c.muted('Max messages:')} ${maxMessages}`);
        console.log(`  ${c.muted('Messages:')}     ${contextSize}`);
        console.log(`  ${c.muted('Tokens (~):')}   ${estimatedTokens.toLocaleString()}`);
        console.log(`\n${c.muted('Usage: /context on [max] | /context off')}\n`);
        break;
    }

    return true;
  },
};

export const usageCommand: CommandHandler = {
  name: 'usage',
  description: 'Show Grok API usage',
  usage: '/usage [reset]',
  execute: async (args, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    if (args[0] === 'reset') {
      context.grokClient.resetUsage();
      console.log(c.success('Statistics reset'));
      return true;
    }

    const usage = context.grokClient.getUsage();
    const contextSize = context.grokClient.getContextSize();
    const estimatedTokens = context.grokClient.estimateTokens();

    console.log(`\n${c.violet('Grok API Usage:')}\n`);
    console.log(`  ${c.muted('Requests:')}      ${usage.requests}`);
    console.log(`  ${c.muted('Prompt:')}        ${usage.promptTokens.toLocaleString()} tokens`);
    console.log(`  ${c.muted('Completion:')}    ${usage.completionTokens.toLocaleString()} tokens`);
    console.log(`  ${c.muted('Total:')}         ${usage.totalTokens.toLocaleString()} tokens`);
    console.log(`\n${c.violet('Current context:')}\n`);
    console.log(`  ${c.muted('Messages:')}      ${contextSize}`);
    console.log(`  ${c.muted('Tokens (~):')}    ${estimatedTokens.toLocaleString()}`);
    console.log(`\n${c.muted('/usage reset to reset statistics')}\n`);

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
  contextCommand,
  usageCommand,
  exitCommand,
];
