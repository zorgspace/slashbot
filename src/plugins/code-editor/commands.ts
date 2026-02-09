/**
 * Code Editor Commands - grep, files
 */

import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

export const grepCommand: CommandHandler = {
  name: 'grep',
  description: 'Search in code',
  usage: '/grep <pattern> [file_pattern]',
  group: 'Code',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      display.errorText('CodeEditor not available');
      return true;
    }

    const pattern = args[0];
    const filePattern = args[1];

    if (!pattern) {
      display.errorText('Pattern required');
      display.muted('Usage: /grep <pattern> [file_pattern]');
      display.muted('Ex: /grep "function" *.ts');
      return true;
    }

    const results = await context.codeEditor.grep(pattern, filePattern);

    if (results.length === 0) {
      display.muted('No results');
    } else {
      display.append('');
      display.violet('Results for "' + pattern + '":');
      display.append('');
      for (const result of results) {
        display.append('  ' + result.file + ':' + String(result.line));
        display.append('    ' + result.content);
      }
      display.append('');
    }
    return true;
  },
};

export const filesCommand: CommandHandler = {
  name: 'files',
  description: 'List project files',
  usage: '/files [pattern]',
  aliases: ['ls'],
  group: 'Code',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      display.errorText('CodeEditor not available');
      return true;
    }

    const pattern = args[0];
    const files = await context.codeEditor.listFiles(pattern);

    if (files.length === 0) {
      display.muted('No files found');
    } else {
      display.append('');
      display.violet('Project files:');
      display.append('');
      files.forEach(f => display.muted('  ' + f));
      display.append('');
      display.muted('Total: ' + files.length + ' file(s)');
      display.append('');
    }
    return true;
  },
};

export const codeEditorCommands: CommandHandler[] = [grepCommand, filesCommand];
