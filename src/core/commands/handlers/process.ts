/**
 * Process Command Handlers - ps, kill
 */

import { c } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const psCommand: CommandHandler = {
  name: 'ps',
  description: 'List background processes',
  usage: '/ps',
  execute: async () => {
    const { processManager } = await import('../../utils/processManager');
    const processes = processManager.list();

    if (processes.length === 0) {
      console.log(c.muted('No background processes running'));
      return true;
    }

    console.log(c.bold('Background Processes:\n'));
    for (const proc of processes) {
      const status = proc.running ? c.success('●') : c.error('○');
      console.log(`${status} ${c.bold(proc.id)} (PID ${proc.pid}) - ${proc.uptime}`);
      console.log(`  ${c.muted(proc.command)}`);
      if (proc.lastOutput) {
        console.log(`  ${c.muted('└ ' + proc.lastOutput.slice(0, 60))}`);
      }
    }
    return true;
  },
};

export const killCommand: CommandHandler = {
  name: 'kill',
  description: 'Kill a background process',
  usage: '/kill <id|pid>',
  execute: async args => {
    const target = args[0];
    if (!target) {
      console.log(c.error('Usage: /kill <id|pid>'));
      console.log(c.muted('Use /ps to list processes'));
      return true;
    }

    const { processManager } = await import('../../utils/processManager');
    const pid = parseInt(target);
    const success = processManager.kill(isNaN(pid) ? target : pid);

    if (success) {
      console.log(c.success(`Killed process: ${target}`));
    } else {
      console.log(c.error(`Failed to kill process: ${target}`));
      console.log(c.muted('Use /ps to list running processes'));
    }
    return true;
  },
};

export const processHandlers: CommandHandler[] = [psCommand, killCommand];
