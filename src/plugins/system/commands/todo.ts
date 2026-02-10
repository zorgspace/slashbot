/**
 * Todo Commands - todo-write
 */

import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

export const todoWriteCommand: CommandHandler = {
  name: 'todo-write',
  description: 'Write a completed todo and show notification',
  usage: '/todo-write <todo text>',
  group: 'System',
  execute: async (args) => {
    const todoText = args.join(' ').trim();
    if (!todoText) {
      display.warning('Please provide todo text: /todo-write <text>');
      return true;
    }

    display.showNotification(todoText);
    return true;
  },
};