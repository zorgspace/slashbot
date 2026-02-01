/**
 * Task Scheduler for Slashbot
 * Embedded cron system - runs only when Slashbot is active
 * Output shown directly in terminal
 *
 * Tasks are stored locally per project in .slashbot/tasks.json
 */

import { c, colors } from '../ui/colors';
import {
  parseCron,
  matchesCron,
  getNextRunTime,
  describeCron,
  isValidCron,
  type ParsedCron,
} from './cron';
import { getLocalSlashbotDir, getLocalTasksFile } from '../constants';

const SLASHBOT_DIR = getLocalSlashbotDir();
const TASKS_FILE = getLocalTasksFile();

// Dangerous patterns to block - NEVER allow these
const DANGEROUS_PATTERNS = [
  // rm on root directory itself or wildcards on root
  /rm\s+(-[a-zA-Z]+\s+)*\/\s*$/,
  /rm\s+(-[a-zA-Z]+\s+)*\/\*/,
  // rm on system directories
  /rm\s+.*\/etc\b/,
  /rm\s+.*\/boot\b/,
  /rm\s+.*\/usr\b/,
  /rm\s+.*\/var\b/,
  /rm\s+.*\/bin\b/,
  /rm\s+.*\/sbin\b/,
  /rm\s+.*\/lib\b/,
  // System destruction
  />\s*\/dev\/sd[a-z]/,
  /dd\s+.*of=\/dev\/sd[a-z]/,
  /mkfs/,
  /:(){ :|:& };:/,
  /chmod\s+(-R\s+)?777\s+\//,
  /chown\s+.*\s+\//,
  />\s*\/etc\//,
  /shutdown/,
  /reboot/,
  /init\s+0/,
  /halt/,
  /poweroff/,
  // Git destructive operations
  /git\s+push\s+.*--force/,
  /git\s+push\s+-f/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-fd/,
];

// Suspicious patterns (warning only, but still execute)
const SUSPICIOUS_PATTERNS = [/sudo/, /su\s+-/, /passwd/, />\s*\//, /eval/, /\$\(/, /`.*`/];

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command?: string; // Bash command to execute (mutually exclusive with prompt)
  prompt?: string; // LLM prompt to process (can search, fetch, notify, etc.)
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastOutput?: string;
  lastSuccess?: boolean;
  runCount: number;
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

// LLM handler type for processing prompts
export type LLMHandler = (prompt: string) => Promise<{ response: string; thinking: string }>;

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private activeTasks: Map<string, ActiveTask> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCheck: Date = new Date();
  private onTaskComplete: (() => void) | null = null;
  private llmHandler: LLMHandler | null = null;

  /**
   * Set callback to run after task completes (e.g., to redraw prompt)
   */
  setOnTaskComplete(callback: () => void): void {
    this.onTaskComplete = callback;
  }

  /**
   * Set LLM handler for processing prompt-based tasks
   * This allows scheduled tasks to use AI capabilities (search, fetch, notify, etc.)
   */
  setLLMHandler(handler: LLMHandler): void {
    this.llmHandler = handler;
  }

  async init(): Promise<void> {
    await this.ensureTasksDir();
    await this.loadTasks();
  }

  private async ensureTasksDir(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(SLASHBOT_DIR, { recursive: true });
  }

  private async loadTasks(): Promise<void> {
    try {
      const file = Bun.file(TASKS_FILE);
      if (await file.exists()) {
        const data = await file.json();
        for (const task of data.tasks || []) {
          // Backward compatibility: old tasks have `script`, new ones have `command`
          this.tasks.set(task.id, {
            ...task,
            command: task.command || task.script || '',
            runCount: task.runCount || 0,
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
    await Bun.write(TASKS_FILE, JSON.stringify(data, null, 2));
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

  /**
   * Add a new scheduled task
   * @param name - Task name (unique identifier)
   * @param cron - Cron expression for scheduling
   * @param commandOrPrompt - Either a bash command or LLM prompt
   * @param options - Optional: { isPrompt: true } to use LLM instead of bash
   */
  async addTask(
    name: string,
    cron: string,
    commandOrPrompt: string,
    options?: { isPrompt?: boolean },
  ): Promise<string | null> {
    const isPrompt = options?.isPrompt ?? false;

    // Check for duplicate task name
    const existingTask = Array.from(this.tasks.values()).find(t => t.name === name);
    if (existingTask) {
      console.log(c.warning(`[CRON] Task "${name}" already exists, skipping`));
      return existingTask.id;
    }

    // Validate cron expression
    if (!isValidCron(cron)) {
      console.log(c.error(`Invalid cron expression: ${cron}`));
      return null;
    }

    // Validate the command (only for bash commands, not prompts)
    if (!isPrompt) {
      const security = this.validateCommand(commandOrPrompt);

      if (security.blocked) {
        console.log(c.error(`[SECURITY] Command blocked!`));
        console.log(c.error(security.blockedReason || 'Dangerous command'));
        return null;
      }

      if (security.warnings.length > 0) {
        console.log(c.warning(`[SECURITY] Warnings:`));
        security.warnings.forEach(w => console.log(c.warning(`  - ${w}`)));
      }
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const task: ScheduledTask = {
      id,
      name,
      cron,
      command: isPrompt ? undefined : commandOrPrompt,
      prompt: isPrompt ? commandOrPrompt : undefined,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
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

    const taskId = task.id;
    this.unregisterTask(taskId);
    const deleted = this.tasks.delete(taskId);

    if (!deleted) return false;

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
    command?: string;
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

  getTasksFile(): string {
    return TASKS_FILE;
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

    // Tick every second to check for due tasks (fire and forget, don't block)
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        console.error(`[CRON] Tick error: ${err?.message || err}`);
      });
    }, 1000);

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
   * Supports both command-based (bash) and prompt-based (LLM) tasks
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const startTime = Date.now();
    const isPromptTask = !!task.prompt && !task.command;

    // Display task start
    console.log('');
    console.log(`${colors.violet}┌─ CRON ${colors.reset}${c.bold(task.name)}`);
    console.log(`${colors.muted}│ ${describeCron(task.cron)}${colors.reset}`);
    if (isPromptTask) {
      console.log(`${colors.muted}│ 🤖 ${task.prompt}${colors.reset}`);
    } else {
      console.log(`${colors.muted}│ $ ${task.command}${colors.reset}`);
    }

    let success = false;
    let output = '';

    try {
      if (isPromptTask) {
        // Execute via LLM handler
        if (!this.llmHandler) {
          throw new Error('LLM handler not configured - cannot execute prompt-based task');
        }
        const result = await this.llmHandler(task.prompt!);
        output = result.response;
        success = true;
      } else if (task.command) {
        // Execute via bash (existing logic)
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        // Wrap command in login shell to load user environment (nvm, pyenv, etc.)
        const wrappedCommand = `bash -lc ${JSON.stringify(task.command)}`;
        const { stdout, stderr } = await execAsync(wrappedCommand, {
          timeout: 60000, // 1 minute timeout
          cwd: process.cwd(),
          env: { ...process.env, BASH_SILENCE_DEPRECATION_WARNING: '1' },
        });

        output = (stdout || stderr || '').trim();
        success = true;
      } else {
        throw new Error('Task has neither command nor prompt defined');
      }

      const duration = Date.now() - startTime;

      // Update task state
      task.lastRun = new Date().toISOString();
      task.lastOutput = output.slice(0, 1000);
      task.lastSuccess = true;
      task.runCount++;

      // Display output
      if (output) {
        const lines = output.split('\n').slice(0, 10);
        lines.forEach(line => {
          console.log(`${colors.muted}│${colors.reset} ${line}`);
        });
        if (output.split('\n').length > 10) {
          console.log(
            `${colors.muted}│ ... (${output.split('\n').length - 10} more lines)${colors.reset}`,
          );
        }
      }

      console.log(
        `${colors.violet}└─${colors.reset} ${c.success('✓')} ${colors.muted}${duration}ms${colors.reset}`,
      );
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

      console.log(
        `${colors.violet}└─${colors.reset} ${c.error('✗')} ${colors.muted}${duration}ms${colors.reset}`,
      );
      console.log('');
    }

    // Save updated task state (only if task still exists - may have been deleted during execution)
    if (this.tasks.has(task.id)) {
      await this.saveTasks();
    }

    // Trigger prompt redraw callback if set
    if (this.onTaskComplete) {
      this.onTaskComplete();
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
