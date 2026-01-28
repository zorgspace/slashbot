/**
 * Task Scheduler for Slashbot
 * Embedded cron system - runs only when Slashbot is active
 * Output shown directly in terminal
 */

import { c, colors } from '../ui/colors';
import * as path from 'path';
import * as os from 'os';
import { parseCron, matchesCron, getNextRunTime, describeCron, isValidCron, type ParsedCron } from './cron';
import type { Notifier } from '../notify/notifier';

const TASKS_DIR = path.join(os.homedir(), '.config', 'slashbot', 'tasks');
const TASKS_INDEX = path.join(TASKS_DIR, 'index.json');

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /rm\s+(-[rfRF]+\s+)*[\/~]\s*$/,
  /rm\s+(-[rfRF]+\s+)*\/\*/,
  /rm\s+(-[rfRF]+\s+)*\//,
  />\s*\/dev\/sd[a-z]/,
  /dd\s+.*of=\/dev\/sd[a-z]/,
  /mkfs/,
  /:(){ :|:& };:/,
  /chmod\s+(-R\s+)?777\s+\//,
  /chown\s+.*\s+\//,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  />\s*\/etc\//,
  /rm\s+.*\/etc/,
  /rm\s+.*\/boot/,
  /rm\s+.*\/usr/,
  /rm\s+.*\/var/,
  /rm\s+.*\/home(?!\/[^\/]+\/)/,
  /shutdown/,
  /reboot/,
  /init\s+0/,
  /halt/,
  /poweroff/,
];

// Suspicious patterns (warning only)
const SUSPICIOUS_PATTERNS = [
  /sudo/,
  /su\s+-/,
  /passwd/,
  /rm\s+-rf/,
  />\s*\//,
  /eval/,
  /\$\(/,
  /`.*`/,
];

export type NotifyService = 'telegram' | 'whatsapp' | 'all' | 'none';

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastOutput?: string;
  lastSuccess?: boolean;
  runCount: number;
  notify?: NotifyService;  // Send notification on completion
}

export interface SecurityCheck {
  safe: boolean;
  blocked: boolean;
  warnings: string[];
  blockedReason?: string;
}

interface ActiveTask {
  task: ScheduledTask;
  parsedCron: ParsedCron;
  nextRun: Date | null;
}

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private activeTasks: Map<string, ActiveTask> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCheck: Date = new Date();
  private notifier: Notifier | null = null;

  /**
   * Set the notifier for sending task notifications
   */
  setNotifier(notifier: Notifier): void {
    this.notifier = notifier;
  }

  async init(): Promise<void> {
    await this.ensureTasksDir();
    await this.loadTasks();
  }

  private async ensureTasksDir(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(TASKS_DIR, { recursive: true });
  }

  private async loadTasks(): Promise<void> {
    try {
      const file = Bun.file(TASKS_INDEX);
      if (await file.exists()) {
        const data = await file.json();
        for (const task of data.tasks || []) {
          // Backward compatibility: old tasks have `script`, new ones have `command`
          this.tasks.set(task.id, {
            ...task,
            command: task.command || task.script || '',
            runCount: task.runCount || 0,
            notify: task.notify || 'none',
          });
        }
      }
    } catch {
      // No tasks yet
    }
  }

  private async saveTasks(): Promise<void> {
    const data = {
      tasks: Array.from(this.tasks.values()),
    };
    await Bun.write(TASKS_INDEX, JSON.stringify(data, null, 2));
  }

  validateCommand(command: string): SecurityCheck {
    const result: SecurityCheck = {
      safe: true,
      blocked: false,
      warnings: [],
    };

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        result.safe = false;
        result.blocked = true;
        result.blockedReason = `Dangerous command detected: ${pattern.toString()}`;
        return result;
      }
    }

    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(command)) {
        result.safe = false;
        result.warnings.push(`Suspicious pattern: ${pattern.toString()}`);
      }
    }

    return result;
  }

  async addTask(name: string, cron: string, command: string, notify?: NotifyService): Promise<string | null> {
    // Validate cron expression
    if (!isValidCron(cron)) {
      console.log(c.error(`Invalid cron expression: ${cron}`));
      return null;
    }

    // Validate the command
    const security = this.validateCommand(command);

    if (security.blocked) {
      console.log(c.error(`[SECURITY] Command blocked!`));
      console.log(c.error(security.blockedReason || 'Dangerous command'));
      return null;
    }

    if (security.warnings.length > 0) {
      console.log(c.warning(`[SECURITY] Warnings:`));
      security.warnings.forEach(w => console.log(c.warning(`  - ${w}`)));
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const task: ScheduledTask = {
      id,
      name,
      cron,
      command,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
      notify: notify || 'none',
    };

    this.tasks.set(id, task);
    await this.saveTasks();

    // Register in active tasks if scheduler is running
    if (this.running) {
      this.registerTask(task);
    }

    return id;
  }

  private registerTask(task: ScheduledTask): void {
    if (!task.enabled) return;

    const parsed = parseCron(task.cron);
    if (!parsed) return;

    const nextRun = getNextRunTime(task.cron);

    this.activeTasks.set(task.id, {
      task,
      parsedCron: parsed,
      nextRun,
    });
  }

  private unregisterTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  async removeTask(idOrIndex: string | number): Promise<boolean> {
    let task: ScheduledTask | undefined;

    if (typeof idOrIndex === 'number') {
      const tasks = Array.from(this.tasks.values());
      task = tasks[idOrIndex];
    } else {
      task = this.tasks.get(idOrIndex);
    }

    if (!task) return false;

    this.unregisterTask(task.id);
    this.tasks.delete(task.id);
    await this.saveTasks();

    return true;
  }

  async updateTaskCron(idOrIndex: string | number, newCron: string): Promise<boolean> {
    if (!isValidCron(newCron)) {
      console.log(c.error(`Invalid cron expression: ${newCron}`));
      return false;
    }

    let task: ScheduledTask | undefined;

    if (typeof idOrIndex === 'number') {
      const tasks = Array.from(this.tasks.values());
      task = tasks[idOrIndex];
    } else {
      task = this.tasks.get(idOrIndex);
    }

    if (!task) return false;

    task.cron = newCron;
    await this.saveTasks();

    // Re-register task
    if (this.running) {
      this.unregisterTask(task.id);
      this.registerTask(task);
    }

    return true;
  }

  async toggleTask(idOrIndex: string | number): Promise<boolean> {
    let task: ScheduledTask | undefined;

    if (typeof idOrIndex === 'number') {
      const tasks = Array.from(this.tasks.values());
      task = tasks[idOrIndex];
    } else {
      task = this.tasks.get(idOrIndex);
    }

    if (!task) return false;

    task.enabled = !task.enabled;
    await this.saveTasks();

    if (task.enabled) {
      this.registerTask(task);
    } else {
      this.unregisterTask(task.id);
    }

    return task.enabled;
  }

  async clearTasks(): Promise<void> {
    this.activeTasks.clear();
    this.tasks.clear();
    await this.saveTasks();
  }

  listTasks(): Array<{
    id: string;
    name: string;
    cron: string;
    command: string;
    enabled: boolean;
    next: string;
    last: string;
    runs: number;
  }> {
    return Array.from(this.tasks.values()).map(task => {
      const nextRun = task.enabled ? getNextRunTime(task.cron) : null;
      return {
        id: task.id,
        name: task.name,
        cron: task.cron,
        command: task.command,
        enabled: task.enabled,
        next: nextRun ? this.formatDate(nextRun) : 'Disabled',
        last: task.lastRun ? this.formatDate(new Date(task.lastRun)) : 'Never',
        runs: task.runCount,
      };
    });
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return 'Now';
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h ${minutes % 60}m`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getTasksDir(): string {
    return TASKS_DIR;
  }

  /**
   * Start the scheduler - checks every second for tasks to run
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.lastCheck = new Date();

    // Register all enabled tasks
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.registerTask(task);
      }
    }

    // Tick every second to check for due tasks
    this.tickInterval = setInterval(() => this.tick(), 1000);

    const taskCount = this.activeTasks.size;
    if (taskCount > 0) {
      console.log(c.muted(`[CRON] ${taskCount} task${taskCount > 1 ? 's' : ''} scheduled`));
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    this.activeTasks.clear();
  }

  /**
   * Check and run due tasks
   */
  private async tick(): Promise<void> {
    const now = new Date();
    now.setSeconds(0);
    now.setMilliseconds(0);

    // Only check once per minute
    const lastMinute = new Date(this.lastCheck);
    lastMinute.setSeconds(0);
    lastMinute.setMilliseconds(0);

    if (now.getTime() === lastMinute.getTime()) {
      return;
    }

    this.lastCheck = now;

    // Check each active task
    for (const [id, active] of this.activeTasks) {
      if (matchesCron(active.parsedCron, now)) {
        await this.executeTask(active.task);

        // Update next run time
        active.nextRun = getNextRunTime(active.task.cron);
      }
    }
  }

  /**
   * Execute a task and display output in terminal
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const startTime = Date.now();

    // Display task start
    console.log('');
    console.log(`${colors.violet}┌─ CRON ${colors.reset}${c.bold(task.name)}`);
    console.log(`${colors.muted}│ ${describeCron(task.cron)}${colors.reset}`);
    console.log(`${colors.muted}│ $ ${task.command}${colors.reset}`);

    let success = false;
    let output = '';

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(task.command, {
        timeout: 60000, // 1 minute timeout
        cwd: process.cwd(),
        env: { ...process.env },
      });

      output = (stdout || stderr || '').trim();
      const duration = Date.now() - startTime;

      // Update task state
      task.lastRun = new Date().toISOString();
      task.lastOutput = output.slice(0, 1000);
      task.lastSuccess = true;
      task.runCount++;
      success = true;

      // Display output
      if (output) {
        const lines = output.split('\n').slice(0, 10);
        lines.forEach(line => {
          console.log(`${colors.muted}│${colors.reset} ${line}`);
        });
        if (output.split('\n').length > 10) {
          console.log(`${colors.muted}│ ... (${output.split('\n').length - 10} more lines)${colors.reset}`);
        }
      }

      console.log(`${colors.violet}└─${colors.reset} ${c.success('✓')} ${colors.muted}${duration}ms${colors.reset}`);
      console.log('');

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.stderr || error.message || String(error);
      output = errorMsg;

      // Update task state
      task.lastRun = new Date().toISOString();
      task.lastOutput = errorMsg.slice(0, 1000);
      task.lastSuccess = false;
      task.runCount++;

      // Display error
      const lines = errorMsg.trim().split('\n').slice(0, 5);
      lines.forEach((line: string) => {
        console.log(`${colors.muted}│${colors.reset} ${c.error(line)}`);
      });

      console.log(`${colors.violet}└─${colors.reset} ${c.error('✗')} ${colors.muted}${duration}ms${colors.reset}`);
      console.log('');
    }

    // Save updated task state
    await this.saveTasks();

    // Send notification if configured
    if (task.notify && task.notify !== 'none' && this.notifier) {
      const statusEmoji = success ? '✅' : '❌';
      const statusText = success ? 'completed' : 'failed';
      const message = `${statusEmoji} Task "${task.name}" ${statusText}\n\n` +
        `Command: ${task.command}\n` +
        `Output: ${output.slice(0, 200)}${output.length > 200 ? '...' : ''}`;

      try {
        if (task.notify === 'telegram') {
          await this.notifier.sendTelegram(message);
        } else if (task.notify === 'whatsapp') {
          await this.notifier.sendWhatsApp(message);
        } else if (task.notify === 'all') {
          await this.notifier.sendAll(message);
        }
      } catch {
        console.log(c.warning('Failed to send notification'));
      }
    }
  }

  /**
   * Run a task immediately (manual trigger)
   */
  async runTask(idOrIndex: string | number): Promise<boolean> {
    let task: ScheduledTask | undefined;

    if (typeof idOrIndex === 'number') {
      const tasks = Array.from(this.tasks.values());
      task = tasks[idOrIndex];
    } else {
      task = this.tasks.get(idOrIndex);
    }

    if (!task) return false;

    await this.executeTask(task);
    return true;
  }

  /**
   * Get status summary
   */
  getStatus(): { running: boolean; taskCount: number; activeCount: number } {
    return {
      running: this.running,
      taskCount: this.tasks.size,
      activeCount: this.activeTasks.size,
    };
  }
}

export function createScheduler(): TaskScheduler {
  return new TaskScheduler();
}

export { describeCron, isValidCron } from './cron';
