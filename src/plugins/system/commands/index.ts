/**
 * System Plugin Commands - Barrel export
 */

import type { CommandHandler } from '../../../core/commands/registry';

// System
export { helpCommand, clearCommand, historyCommand, exitCommand, bannerCommand } from './system';

// Personality
export {
  depressedCommand,
  sarcasmCommand,
  normalCommand,
  unhingedCommand,
  getCurrentPersonality,
  getPersonalityMod,
} from './personality';
export type { Personality } from './personality';

// Code
export { pasteImageCommand, initCommand } from './code';

// Update
export { updateCommand } from './update';

// Process
export { psCommand, killCommand } from './process';

export { todoWriteCommand } from './todo';

// Plugin
export { pluginCommand } from './plugin';

// Aggregate all commands
import { helpCommand, clearCommand, historyCommand, exitCommand, bannerCommand } from './system';
import { depressedCommand, sarcasmCommand, normalCommand, unhingedCommand } from './personality';
import { pasteImageCommand, initCommand } from './code';
import { updateCommand } from './update';
import { psCommand, killCommand } from './process';
import { todoWriteCommand } from './todo';
import { pluginCommand } from './plugin';

export const systemPluginCommands: CommandHandler[] = [
  // System
  helpCommand,
  clearCommand,
  historyCommand,
  exitCommand,
  bannerCommand,
  // Personality
  depressedCommand,
  sarcasmCommand,
  normalCommand,
  unhingedCommand,
  // Images
  pasteImageCommand,
  // Init
  initCommand,
  // Update
  updateCommand,
  // Process
  psCommand,
  killCommand,
  // Todo
  todoWriteCommand,
  // Plugins
  pluginCommand,
];
