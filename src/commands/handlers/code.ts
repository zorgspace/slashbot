/**
 * Code Command Handlers - grep, files, read, write, ls
 */

import { c } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const grepCommand: CommandHandler = {
  name: 'grep',
  description: 'Search in code',
  usage: '/grep <pattern> [file_pattern]',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      console.log(c.error('CodeEditor not available'));
      return true;
    }

    const pattern = args[0];
    const filePattern = args[1];

    if (!pattern) {
      console.log(c.error('Pattern required'));
      console.log(c.muted('Usage: /grep <pattern> [file_pattern]'));
      console.log(c.muted('Ex: /grep "function" *.ts'));
      return true;
    }

    const results = await context.codeEditor.grep(pattern, filePattern);

    if (results.length === 0) {
      console.log(c.muted('No results'));
    } else {
      console.log(`\n${c.violet(`Results for "${pattern}":`)}\n`);
      for (const result of results) {
        console.log(`  ${c.violet(result.file)}:${c.muted(String(result.line))}`);
        console.log(`    ${result.content}`);
      }
      console.log();
    }
    return true;
  },
};

export const filesCommand: CommandHandler = {
  name: 'files',
  description: 'List project files',
  usage: '/files [pattern]',
  aliases: ['ls'],
  execute: async (args, context) => {
    if (!context.codeEditor) {
      console.log(c.error('CodeEditor not available'));
      return true;
    }

    const pattern = args[0];
    const files = await context.codeEditor.listFiles(pattern);

    if (files.length === 0) {
      console.log(c.muted('No files found'));
    } else {
      console.log(`\n${c.violet('Project files:')}\n`);
      files.forEach(f => console.log(`  ${c.muted(f)}`));
      console.log(`\n${c.muted(`Total: ${files.length} file(s)`)}\n`);
    }
    return true;
  },
};

export const readCommand: CommandHandler = {
  name: 'read',
  description: 'Read a local file',
  usage: '/read <path>',
  execute: async (args, context) => {
    const filePath = args[0];
    if (!filePath) {
      console.log(c.error('File path required'));
      return true;
    }

    try {
      const content = await context.fileSystem?.readFile(filePath);
      console.log(`\n${c.violet(`─── ${filePath} ───`)}\n`);
      console.log(content);
      console.log(`\n${c.violet('─── end ───')}\n`);
    } catch (error) {
      console.log(c.error(`Could not read file: ${error}`));
    }
    return true;
  },
};

export const writeCommand: CommandHandler = {
  name: 'write',
  description: 'Write to a file',
  usage: '/write <path> <content>',
  execute: async (args, context) => {
    const filePath = args[0];
    const content = args.slice(1).join(' ');

    if (!filePath) {
      console.log(c.error('Usage: /write <path> <content>'));
      return true;
    }

    if (!content) {
      console.log(c.error('Content missing'));
      console.log(c.muted('Usage: /write <path> <content>'));
      return true;
    }

    const result = await context.fileSystem?.writeFile(filePath, content);
    if (result) {
      console.log(c.success(`File written: ${filePath}`));
    }
    return true;
  },
};

export const codeHandlers: CommandHandler[] = [
  grepCommand,
  filesCommand,
  readCommand,
  writeCommand,
];
