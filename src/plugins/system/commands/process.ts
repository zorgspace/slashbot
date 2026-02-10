/**
 * Process Commands - ps, kill
 */

import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

export const psCommand: CommandHandler = {
  name: 'ps',
  description: 'List background processes',
  usage: '/ps',
  group: 'System',
  execute: async () => {
    const { processManager } = await import('../../bash/services/ProcessManager');
    const processes = processManager.list();

    if (processes.length === 0) {
      display.muted('No background processes running');
      return true;
    }

    display.boldText('Background Processes:');
    display.append('');
    for (const proc of processes) {
      const statusIcon = proc.running ? '[OK]' : '[STOPPED]';
      display.append(statusIcon + ' ' + proc.id + ' (PID ' + proc.pid + ') - ' + proc.uptime);
      display.muted('  ' + proc.command);
      if (proc.lastOutput) {
        display.muted('  ' + proc.lastOutput.slice(0, 60));
      }
    }
    return true;
  },
};

export const killCommand: CommandHandler = {
  name: 'kill',
  description: 'Kill a background process',
  usage: '/kill <id|pid>',
  group: 'System',
  execute: async args => {
    const target = args[0];
    if (!target) {
      display.errorText('Usage: /kill <id|pid>');
      display.muted('Use /ps to list processes');
      return true;
    }

    const { processManager } = await import('../../bash/services/ProcessManager');
    const pid = parseInt(target);
    const success = processManager.kill(isNaN(pid) ? target : pid);

    if (success) {
      display.successText('Killed process: ' + target);
    } else {
      display.errorText('Failed to kill process: ' + target);
      display.muted('Use /ps to list running processes');
    }
    return true;
  },
};
