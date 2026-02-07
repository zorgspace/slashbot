/**
 * Slash Command Parser for Slashbot
 *
 * This module provides command parsing and execution.
 * Command handlers are defined in ./handlers/ and registered via CommandRegistry.
 */

import { display } from '../ui';
import clipboardy from 'clipboardy';
import terminalImage from 'terminal-image';
import { imageBuffer, addImage, getImage } from '../code/imageBuffer';

// Re-export types from registry
export type { CommandHandler, CommandContext, ConnectorHandle } from './registry';

export interface ParsedCommand {
  isCommand: boolean;
  command?: string;
  args: string[];
  rawArgs: string;
}

export function parse(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return {
      isCommand: false,
      args: [],
      rawArgs: trimmed,
    };
  }
  const parts = trimmed.slice(1).trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return {
    isCommand: true,
    command,
    args,
    rawArgs: trimmed.slice(1),
  };
}

async function copyToClipboard(text: string) {
  try {
    await clipboardy.write(text);
    display.successText('Copied to clipboard');
  } catch (e) {
    display.errorText('Copy failed');
  }
}

async function displayImage(n: number) {
  const imgPath = getImage(n);
  if (!imgPath) {
    display.errorText('Image not found');
    return;
  }
  try {
    let image;
    if (imgPath.startsWith('data:image/')) {
      const base64Data = imgPath.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      image = await terminalImage.buffer(buffer);
    } else {
      image = await terminalImage.file(imgPath);
    }
    console.log(image);
  } catch (e) {
    display.errorText('Display failed');
  }
}

export async function parseInput(input: string): Promise<ParsedCommand> {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return {
      isCommand: false,
      args: [],
      rawArgs: trimmed,
    };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const rawArgs = args.join(' ');

  // Handle immediate commands here (copy, image)
  if (command === 'copy') {
    await copyToClipboard(rawArgs || 'Last output');
    return { isCommand: false, args: [], rawArgs: '' };
  }
  if (command === 'image' && args[0]) {
    const n = parseInt(args[0]);
    if (n > 0) {
      await displayImage(n);
      return { isCommand: false, args: [], rawArgs: '' };
    }
  }
  if (command === 'image-add' && args[0]) {
    addImage(args[0]);
    display.successText(`Image added: Image${imageBuffer.length}`);
    return { isCommand: false, args: [], rawArgs: '' };
  }

  return {
    isCommand: true,
    command,
    args,
    rawArgs,
  };
}

import type { CommandContext } from './registry';

// Import registry and handlers - will be initialized by DI
import { getService, TYPES } from '../di/container';
import type { CommandRegistry } from './registry';

/**
 * Execute a parsed command using the CommandRegistry
 */
export async function executeCommand(
  parsed: ParsedCommand,
  context: CommandContext,
): Promise<boolean> {
  if (!parsed.isCommand || !parsed.command) {
    return false;
  }

  try {
    const registry = getService<CommandRegistry>(TYPES.CommandRegistry);
    const handler = registry.get(parsed.command);

    if (!handler) {
      display.errorText(`Unknown command: /${parsed.command}`);
      display.muted('Use /help to see available commands');
      return true;
    }

    return handler.execute(parsed.args, context);
  } catch (error) {
    // If DI not initialized yet, show error
    display.errorText(`Command execution failed: ${error}`);
    return true;
  }
}

/**
 * Get all command names for autocomplete
 */
export function getCommandNames(): string[] {
  try {
    const registry = getService<CommandRegistry>(TYPES.CommandRegistry);
    return registry.getNames().map(cmd => `/${cmd}`);
  } catch {
    return [];
  }
}

/**
 * Completer function for readline
 */
export function completer(line: string): [string[], string] {
  const commandNames = getCommandNames();

  if (line === '') {
    // Empty line - show all commands
    return [commandNames, line];
  }

  if (line.startsWith('/')) {
    // Check for subcommands
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);

    if (parts.length === 2 && parts[1] === '') {
      // Line ends with space, like "/wallet "
      const baseCommand = parts[0];
      try {
        const registry = getService<CommandRegistry>(TYPES.CommandRegistry);
        const handler = registry.get(baseCommand);
        if (handler && handler.usage) {
          console.log('\n' + handler.usage);
          return [[], line];
        }
      } catch {
        // Fall back to subcommands
      }
      const subcommands = getSubcommands(baseCommand);
      if (subcommands.length > 0) {
        return [subcommands.map(sub => `${baseCommand} ${sub}`), line];
      }
    }

    if (parts.length >= 2) {
      // Line has multiple parts, like "/wallet c"
      const baseCommand = parts[0];
      const currentSub = parts.slice(1).join(' ');
      const subcommands = getSubcommands(baseCommand);
      if (subcommands.length > 0) {
        const filteredSubs = subcommands.filter(sub => sub.startsWith(currentSub));
        if (filteredSubs.length > 0) {
          const suggestions = filteredSubs.map(sub => `${baseCommand} ${sub}`);
          return [suggestions, line];
        }
      }
    }

    // Filter commands that start with the current line
    const filtered = commandNames.filter(cmd => cmd.startsWith(line));
    if (filtered.length > 0) {
      return [filtered, line];
    } else {
      // No matches, show all
      return [commandNames, line];
    }
  }

  // For any other input, show all slash commands (Tab completion should always show available commands)
  return [commandNames, line];
}

/**
 * Get subcommands for a given command
 */
function getSubcommands(command: string): string[] {
  const subcommandsMap: Record<string, string[]> = {
    '/wallet': [
      'create',
      'import',
      'export',
      'balance',
      'send',
      'redeem',
      'unlock',
      'lock',
      'status',
      'pricing',
      'mode',
      'usage',
    ],
    // Add other commands with subcommands if needed
  };

  return subcommandsMap[command] || [];
}

/**
 * Get all commands with descriptions for beautiful display
 */
export function getCommandsWithDescriptions(): Array<{ name: string; description: string }> {
  try {
    const registry = getService<CommandRegistry>(TYPES.CommandRegistry);
    const handlers = registry.getAll();
    return handlers.map(handler => ({
      name: handler.name,
      description: handler.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Get grouped commands for beautiful tab completion display
 */
export function getGroupedCommands(): Array<{
  title: string;
  cmds: Array<{ name: string; description: string }>;
}> {
  try {
    const registry = getService<CommandRegistry>(TYPES.CommandRegistry);
    const groupMap = new Map<string, Array<{ name: string; description: string }>>();

    for (const handler of registry.getAll()) {
      const group = handler.group || 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push({ name: handler.name, description: handler.description });
    }

    return Array.from(groupMap.entries()).map(([title, cmds]) => ({ title, cmds }));
  } catch {
    return [];
  }
}
