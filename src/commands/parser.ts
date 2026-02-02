/**
 * Slash Command Parser for Slashbot
 *
 * This module provides command parsing and execution.
 * Command handlers are defined in ./handlers/ and registered via CommandRegistry.
 */

import { c } from '../ui/colors';
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
    console.log(c.success('Copied to clipboard'));
  } catch (e) {
    console.log(c.error('Copy failed'));
  }
}

async function displayImage(n: number) {
  const imgPath = getImage(n);
  if (!imgPath) {
    console.log(c.error('Image not found'));
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
    console.log(c.error('Display failed'));
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
    console.log(c.success(`Image added: Image${imageBuffer.length}`));
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
      console.log(c.error(`Unknown command: /${parsed.command}`));
      console.log(c.muted('Use /help to see available commands'));
      return true;
    }

    return handler.execute(parsed.args, context);
  } catch (error) {
    // If DI not initialized yet, show error
    console.log(c.error(`Command execution failed: ${error}`));
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

  if (line.startsWith('/')) {
    const hits = commandNames.filter(cmd => cmd.startsWith(line));
    return [hits.length ? hits : commandNames, line];
  }

  return [[], line];
}
