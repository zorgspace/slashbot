import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

export const gitStatusCommand: CommandHandler = {
  name: 'git',
  description: 'Git operations',
  usage: '/git [status|log|diff]',
  group: 'Git',
  execute: async (args) => {
    const subcommand = args[0] || 'status';

    const proc = Bun.spawn(['git', subcommand, ...args.slice(1)], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      display.errorText(stderr || 'Git command failed');
    } else {
      display.append(stdout || '(no output)');
    }

    return true;
  },
};

export const gitCommands: CommandHandler[] = [gitStatusCommand];
