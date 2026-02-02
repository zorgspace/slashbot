/**
 * Task Command Handlers - task, tasks
 */

import { c } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const taskCommand: CommandHandler = {
  name: 'task',
  description: 'Manage scheduled tasks',
  usage: '/task [list|run|remove|toggle|cron|clear] [id]',
  aliases: ['tasks'],
  execute: async (args, context) => {
    const subcommand = args[0] || 'list';
    const tasks = context.scheduler?.listTasks() || [];
    const status = context.scheduler?.getStatus() || {};

    switch (subcommand) {
      case 'list':
        if (tasks.length === 0) {
          console.log(c.muted('\nNo scheduled tasks'));
          console.log(c.muted('Ask Slashbot to create a task in natural language.\n'));
        } else {
          console.log(
            `\n${c.violet('Scheduled tasks:')} ${status.running ? c.success('(running)') : c.warning('(stopped)')}\n`,
          );
          tasks.forEach((task: any, i: number) => {
            const statusIcon = task.enabled ? c.success('●') : c.muted('○');
            console.log(`  ${statusIcon} ${c.violet(`[${i + 1}]`)} ${task.name}`);
            console.log(`      ${c.muted('Cron:')}    ${task.cron}`);
            console.log(
              `      ${c.muted('Command:')} ${task.command.slice(0, 50)}${task.command.length > 50 ? '...' : ''}`,
            );
            console.log(
              `      ${c.muted('Next:')}    ${task.next}  ${c.muted(`(${task.runs} runs)`)}`,
            );
          });
          console.log(`\n${c.muted('Commands: /task run|remove|toggle|cron <id>')}\n`);
        }
        break;

      case 'run':
        const runId = parseInt(args[1]) - 1;
        if (isNaN(runId) || runId < 0 || runId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task run <id>'));
          return true;
        }

        const taskToRun = tasks[runId];
        console.log(c.muted(`Running: ${taskToRun.name}...`));
        if (await context.scheduler?.runTask(runId)) {
          // Output is shown by the scheduler
        } else {
          console.log(c.error('Run error'));
        }
        break;

      case 'remove':
      case 'delete':
      case 'rm':
        const removeId = parseInt(args[1]) - 1;
        if (isNaN(removeId) || removeId < 0 || removeId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task remove <id>'));
          return true;
        }

        const taskToRemove = tasks[removeId];
        if (await context.scheduler?.removeTask(removeId)) {
          console.log(c.success(`Removed: ${taskToRemove.name}`));
        } else {
          console.log(c.error('Remove error'));
        }
        break;

      case 'toggle':
        const toggleId = parseInt(args[1]) - 1;
        if (isNaN(toggleId) || toggleId < 0 || toggleId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task toggle <id>'));
          return true;
        }

        const enabled = await context.scheduler?.toggleTask(toggleId);
        const taskToggled = tasks[toggleId];
        console.log(
          enabled
            ? c.success(`Enabled: ${taskToggled.name}`)
            : c.warning(`Disabled: ${taskToggled.name}`),
        );
        break;

      case 'cron':
        const cronId = parseInt(args[1]) - 1;
        const newCron = args.slice(2).join(' ');
        if (isNaN(cronId) || cronId < 0 || cronId >= tasks.length || !newCron) {
          console.log(c.error('Usage: /task cron <id> <expression>'));
          console.log(c.muted('Ex: /task cron 1 0 8 * * *  (daily at 8am)'));
          return true;
        }

        if (await context.scheduler?.updateTaskCron(cronId, newCron)) {
          console.log(c.success(`Cron updated: ${newCron}`));
        } else {
          console.log(c.error('Update error'));
        }
        break;

      case 'clear':
        if (tasks.length === 0) {
          console.log(c.muted('No tasks'));
          return true;
        }

        await context.scheduler?.clearTasks();
        console.log(c.success(`${tasks.length} task(s) removed`));
        break;

      case 'status':
        console.log(`\n${c.violet('Scheduler status:')}\n`);
        console.log(
          `  ${c.muted('Running:')}  ${status.running ? c.success('Yes') : c.warning('No')}`,
        );
        console.log(`  ${c.muted('Tasks:')}    ${status.taskCount}`);
        console.log(`  ${c.muted('Active:')}   ${status.activeCount}\n`);
        break;

      default:
        console.log(c.muted('Commands: list, run, remove, toggle, cron, clear, status'));
    }

    return true;
  },
};

export const taskHandlers: CommandHandler[] = [taskCommand];
