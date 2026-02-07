/**
 * Scheduling Commands - task, tasks
 */

import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';

export const taskCommand: CommandHandler = {
  name: 'task',
  description: 'Manage scheduled tasks',
  usage: '/task [list|run|remove|toggle|cron|clear] [id]',
  aliases: ['tasks'],
  group: 'Tasks',
  subcommands: ['list', 'run', 'remove', 'toggle', 'cron', 'clear', 'status'],
  execute: async (args, context) => {
    const subcommand = args[0] || 'list';
    const tasks = context.scheduler?.listTasks() || [];
    const status = context.scheduler?.getStatus() || {};

    switch (subcommand) {
      case 'list':
        if (tasks.length === 0) {
          display.append('');
          display.muted('No scheduled tasks');
          display.muted('Ask Slashbot to create a task in natural language.');
          display.append('');
        } else {
          display.append('');
          display.violet('Scheduled tasks: ' + (status.running ? '(running)' : '(stopped)'));
          display.append('');
          tasks.forEach((task: any, i: number) => {
            const statusIcon = task.enabled ? '[*]' : '[ ]';
            display.append('  ' + statusIcon + ' [' + (i + 1) + '] ' + task.name);
            display.muted('      Cron:    ' + task.cron);
            display.muted(
              '      Command: ' +
                task.command.slice(0, 50) +
                (task.command.length > 50 ? '...' : ''),
            );
            display.muted('      Next:    ' + task.next + '  (' + task.runs + ' runs)');
          });
          display.append('');
          display.muted('Commands: /task run|remove|toggle|cron <id>');
          display.append('');
        }
        break;

      case 'run':
        const runId = parseInt(args[1]) - 1;
        if (isNaN(runId) || runId < 0 || runId >= tasks.length) {
          display.errorText('Invalid ID. Usage: /task run <id>');
          return true;
        }

        const taskToRun = tasks[runId];
        display.muted('Running: ' + taskToRun.name + '...');
        if (await context.scheduler?.runTask(runId)) {
          // Output is shown by the scheduler
        } else {
          display.errorText('Run error');
        }
        break;

      case 'remove':
      case 'delete':
      case 'rm':
        const removeId = parseInt(args[1]) - 1;
        if (isNaN(removeId) || removeId < 0 || removeId >= tasks.length) {
          display.errorText('Invalid ID. Usage: /task remove <id>');
          return true;
        }

        const taskToRemove = tasks[removeId];
        if (await context.scheduler?.removeTask(removeId)) {
          display.successText('Removed: ' + taskToRemove.name);
        } else {
          display.errorText('Remove error');
        }
        break;

      case 'toggle':
        const toggleId = parseInt(args[1]) - 1;
        if (isNaN(toggleId) || toggleId < 0 || toggleId >= tasks.length) {
          display.errorText('Invalid ID. Usage: /task toggle <id>');
          return true;
        }

        const enabled = await context.scheduler?.toggleTask(toggleId);
        const taskToggled = tasks[toggleId];
        if (enabled) {
          display.successText('Enabled: ' + taskToggled.name);
        } else {
          display.warningText('Disabled: ' + taskToggled.name);
        }
        break;

      case 'cron':
        const cronId = parseInt(args[1]) - 1;
        const newCron = args.slice(2).join(' ');
        if (isNaN(cronId) || cronId < 0 || cronId >= tasks.length || !newCron) {
          display.errorText('Usage: /task cron <id> <expression>');
          display.muted('Ex: /task cron 1 0 8 * * *  (daily at 8am)');
          return true;
        }

        if (await context.scheduler?.updateTaskCron(cronId, newCron)) {
          display.successText('Cron updated: ' + newCron);
        } else {
          display.errorText('Update error');
        }
        break;

      case 'clear':
        if (tasks.length === 0) {
          display.muted('No tasks');
          return true;
        }

        await context.scheduler?.clearTasks();
        display.successText(tasks.length + ' task(s) removed');
        break;

      case 'status':
        display.append('');
        display.violet('Scheduler status:');
        display.append('');
        display.append('  Running:  ' + (status.running ? 'Yes' : 'No'));
        display.append('  Tasks:    ' + status.taskCount);
        display.append('  Active:   ' + status.activeCount);
        display.append('');
        break;

      default:
        display.muted('Commands: list, run, remove, toggle, cron, clear, status');
    }

    return true;
  },
};

export const schedulingCommands: CommandHandler[] = [taskCommand];
