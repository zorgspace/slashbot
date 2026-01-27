/**
 * Task Scheduler for Slashbot
 * Creates real cron jobs with shell scripts
 * Persisted in ~/.config/slashbot/tasks/
 */

import { c, colors } from '../ui/colors';
import * as path from 'path';
import * as os from 'os';

const TASKS_DIR = path.join(os.homedir(), '.config', 'slashbot', 'tasks');
const TASKS_INDEX = path.join(TASKS_DIR, 'index.json');

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /rm\s+(-[rfRF]+\s+)*[\/~]\s*$/,          // rm -rf / or rm -rf ~
  /rm\s+(-[rfRF]+\s+)*\/\*/,               // rm -rf /*
  /rm\s+(-[rfRF]+\s+)*\//,                 // rm -rf /
  />\s*\/dev\/sd[a-z]/,                    // Write to disk devices
  /dd\s+.*of=\/dev\/sd[a-z]/,              // dd to disk
  /mkfs/,                                   // Format filesystem
  /:(){ :|:& };:/,                          // Fork bomb
  /chmod\s+(-R\s+)?777\s+\//,              // chmod 777 /
  /chown\s+.*\s+\//,                       // chown /
  /curl.*\|\s*(ba)?sh/,                    // curl | bash
  /wget.*\|\s*(ba)?sh/,                    // wget | bash
  />\s*\/etc\//,                           // Overwrite /etc
  /rm\s+.*\/etc/,                          // Delete /etc
  /rm\s+.*\/boot/,                         // Delete /boot
  /rm\s+.*\/usr/,                          // Delete /usr
  /rm\s+.*\/var/,                          // Delete /var
  /rm\s+.*\/home(?!\/[^\/]+\/)/,           // Delete /home but not subdirs
  /shutdown/,                               // Shutdown
  /reboot/,                                 // Reboot
  /init\s+0/,                              // Halt
  /halt/,                                   // Halt
  /poweroff/,                              // Poweroff
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

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  script: string;
  scriptPath: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
}

export interface SecurityCheck {
  safe: boolean;
  blocked: boolean;
  warnings: string[];
  blockedReason?: string;
}

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();

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
          this.tasks.set(task.id, task);
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

    // Check for blocked patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        result.safe = false;
        result.blocked = true;
        result.blockedReason = `Dangerous command detected: ${pattern.toString()}`;
        return result;
      }
    }

    // Check for suspicious patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(command)) {
        result.safe = false;
        result.warnings.push(`Pattern suspect: ${pattern.toString()}`);
      }
    }

    return result;
  }

  async addTask(name: string, cron: string, script: string): Promise<string | null> {
    // Validate the script
    const security = this.validateCommand(script);

    if (security.blocked) {
      console.log(c.error(`[SECURITY] Command blocked!`));
      console.log(c.error(security.blockedReason || 'Commande dangereuse'));
      return null;
    }

    if (security.warnings.length > 0) {
      console.log(c.warning(`[SECURITY] Avertissements:`));
      security.warnings.forEach(w => console.log(c.warning(`  - ${w}`)));
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scriptPath = path.join(TASKS_DIR, `${id}.sh`);

    // Create shell script
    const scriptContent = `#!/bin/bash
# Slashbot Task: ${name}
# Cron: ${cron}
# Created: ${new Date().toISOString()}
#
# Edit this file to modify the task
# Run manually: bash ${scriptPath}

set -e  # Exit on error

# --- Task Script ---
${script}
`;

    try {
      await Bun.write(scriptPath, scriptContent);

      // Make executable
      const { chmod } = await import('fs/promises');
      await chmod(scriptPath, 0o755);

      const task: ScheduledTask = {
        id,
        name,
        cron,
        script,
        scriptPath,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      this.tasks.set(id, task);
      await this.saveTasks();

      // Add to system crontab
      await this.addToCrontab(task);

      return id;
    } catch (error) {
      console.log(c.error(`Task creation error: ${error}`));
      return null;
    }
  }

  private async addToCrontab(task: ScheduledTask): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Get current crontab
      let currentCrontab = '';
      try {
        const { stdout } = await execAsync('crontab -l 2>/dev/null');
        currentCrontab = stdout;
      } catch {
        // No crontab yet
      }

      // Remove old entry for this task if exists
      const lines = currentCrontab.split('\n').filter(line =>
        !line.includes(`# slashbot:${task.id}`)
      );

      // Add new entry
      const cronLine = `${task.cron} ${task.scriptPath} >> ~/.config/slashbot/tasks/logs/${task.id}.log 2>&1 # slashbot:${task.id}`;
      lines.push(cronLine);

      // Create logs dir
      const { mkdir } = await import('fs/promises');
      await mkdir(path.join(TASKS_DIR, 'logs'), { recursive: true });

      // Write new crontab
      const newCrontab = lines.filter(l => l.trim()).join('\n') + '\n';
      await execAsync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`);

      return true;
    } catch (error) {
      console.log(c.warning(`Crontab unavailable, task saved locally only`));
      return false;
    }
  }

  private async removeFromCrontab(taskId: string): Promise<void> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('crontab -l 2>/dev/null');
      const lines = stdout.split('\n').filter(line =>
        !line.includes(`# slashbot:${taskId}`)
      );

      const newCrontab = lines.filter(l => l.trim()).join('\n') + '\n';
      await execAsync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`);
    } catch {
      // Ignore crontab errors
    }
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

    // Remove from crontab
    await this.removeFromCrontab(task.id);

    // Remove script file
    try {
      const { unlink } = await import('fs/promises');
      await unlink(task.scriptPath);
    } catch {
      // File might not exist
    }

    this.tasks.delete(task.id);
    await this.saveTasks();

    return true;
  }

  async editTask(idOrIndex: string | number): Promise<string | null> {
    let task: ScheduledTask | undefined;

    if (typeof idOrIndex === 'number') {
      const tasks = Array.from(this.tasks.values());
      task = tasks[idOrIndex];
    } else {
      task = this.tasks.get(idOrIndex);
    }

    if (!task) return null;

    return task.scriptPath;
  }

  async updateTaskCron(idOrIndex: string | number, newCron: string): Promise<boolean> {
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

    // Update crontab
    await this.removeFromCrontab(task.id);
    await this.addToCrontab(task);

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
      await this.addToCrontab(task);
    } else {
      await this.removeFromCrontab(task.id);
    }

    return task.enabled;
  }

  async clearTasks(): Promise<void> {
    for (const task of this.tasks.values()) {
      await this.removeFromCrontab(task.id);
      try {
        const { unlink } = await import('fs/promises');
        await unlink(task.scriptPath);
      } catch {
        // Ignore
      }
    }
    this.tasks.clear();
    await this.saveTasks();
  }

  listTasks(): Array<{
    id: string;
    name: string;
    cron: string;
    scriptPath: string;
    enabled: boolean;
    next: string;
    last: string;
  }> {
    return Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      name: task.name,
      cron: task.cron,
      scriptPath: task.scriptPath,
      enabled: task.enabled,
      next: this.getNextRun(task.cron),
      last: task.lastRun || 'Jamais',
    }));
  }

  private getNextRun(cron: string): string {
    // Simple next run calculation
    const parts = cron.split(' ');
    if (parts.length !== 5) return 'Invalid cron';

    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date();

    if (hour !== '*') {
      next.setHours(parseInt(hour));
    }
    if (minute !== '*') {
      next.setMinutes(parseInt(minute));
    }
    next.setSeconds(0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next.toLocaleString('fr-FR');
  }

  getTasksDir(): string {
    return TASKS_DIR;
  }

  // For legacy compatibility
  start(): void {
    // Tasks are managed by system cron now
  }

  stop(): void {
    // Nothing to stop
  }
}

export function createScheduler(): TaskScheduler {
  const scheduler = new TaskScheduler();
  return scheduler;
}
