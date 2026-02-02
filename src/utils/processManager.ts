/**
 * Process Manager - Track and control background processes
 */

import { spawn, ChildProcess } from 'child_process';
import { c } from '../ui/colors';

export interface ManagedProcess {
  id: string;
  pid: number;
  command: string;
  startedAt: Date;
  process: ChildProcess;
  output: string[];
}

class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private idCounter = 0;

  /**
   * Spawn a background process
   */
  spawn(command: string, cwd?: string): ManagedProcess {
    const id = `proc_${++this.idCounter}`;

    // Use nohup + setsid to fully detach from terminal
    // - nohup: ignores SIGHUP and redirects output
    // - setsid: creates new session (no controlling terminal)
    // - </dev/null: closes stdin to prevent terminal read attempts
    const wrappedCommand = `${command} </dev/null`;
    const proc = spawn('setsid', ['-f', 'bash', '-lc', wrappedCommand], {
      cwd: cwd || process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BASH_SILENCE_DEPRECATION_WARNING: '1',
        DEBIAN_FRONTEND: 'noninteractive',
        // Tell programs they're not running in a terminal
        TERM: 'dumb',
      },
    });

    const managed: ManagedProcess = {
      id,
      pid: proc.pid!,
      command,
      startedAt: new Date(),
      process: proc,
      output: [],
    };

    // Capture output
    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data
        .toString()
        .split('\n')
        .filter(l => l.trim());
      managed.output.push(...lines);
      // Keep only last 100 lines
      if (managed.output.length > 100) {
        managed.output = managed.output.slice(-100);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data
        .toString()
        .split('\n')
        .filter(l => l.trim());
      managed.output.push(...lines.map(l => `[stderr] ${l}`));
      if (managed.output.length > 100) {
        managed.output = managed.output.slice(-100);
      }
    });

    // Clean up when process exits
    proc.on('exit', code => {
      managed.output.push(`[exited with code ${code}]`);
    });

    this.processes.set(id, managed);
    console.log(c.muted(`[Process] Started ${id} (PID ${proc.pid}): ${command.slice(0, 50)}...`));

    return managed;
  }

  /**
   * Kill a process by ID or PID (kills entire process group)
   */
  kill(idOrPid: string | number): boolean {
    let managed: ManagedProcess | undefined;

    if (typeof idOrPid === 'string') {
      managed = this.processes.get(idOrPid);
    } else {
      managed = Array.from(this.processes.values()).find(p => p.pid === idOrPid);
    }

    if (!managed) {
      // Try to kill by PID directly
      try {
        const pid = typeof idOrPid === 'number' ? idOrPid : parseInt(idOrPid);
        // Kill process group (negative PID) to kill all children
        process.kill(-pid, 'SIGTERM');
        return true;
      } catch {
        try {
          // Fallback to killing just the process
          process.kill(typeof idOrPid === 'number' ? idOrPid : parseInt(idOrPid), 'SIGTERM');
          return true;
        } catch {
          return false;
        }
      }
    }

    try {
      // Kill entire process group (negative PID kills all children)
      try {
        process.kill(-managed.pid, 'SIGTERM');
      } catch {
        // Fallback to killing just the main process
        managed.process.kill('SIGTERM');
      }

      setTimeout(() => {
        if (!managed!.process.killed) {
          try {
            process.kill(-managed!.pid, 'SIGKILL');
          } catch {
            managed!.process.kill('SIGKILL');
          }
        }
      }, 2000);
      this.processes.delete(managed.id);
      console.log(c.muted(`[Process] Killed ${managed.id} (PID ${managed.pid})`));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all managed processes
   */
  list(): Array<{
    id: string;
    pid: number;
    command: string;
    running: boolean;
    uptime: string;
    lastOutput: string;
  }> {
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      pid: p.pid,
      command: p.command.length > 60 ? p.command.slice(0, 57) + '...' : p.command,
      running: !p.process.killed,
      uptime: this.formatUptime(p.startedAt),
      lastOutput: p.output.slice(-1)[0] || '',
    }));
  }

  /**
   * Get process output
   */
  getOutput(idOrPid: string | number, lines = 20): string[] {
    let managed: ManagedProcess | undefined;

    if (typeof idOrPid === 'string') {
      managed = this.processes.get(idOrPid);
    } else {
      managed = Array.from(this.processes.values()).find(p => p.pid === idOrPid);
    }

    return managed?.output.slice(-lines) || [];
  }

  /**
   * Check if a process is running
   */
  isRunning(idOrPid: string | number): boolean {
    let managed: ManagedProcess | undefined;

    if (typeof idOrPid === 'string') {
      managed = this.processes.get(idOrPid);
    } else {
      managed = Array.from(this.processes.values()).find(p => p.pid === idOrPid);
    }

    return managed ? !managed.process.killed : false;
  }

  /**
   * Clean up dead processes
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [id, managed] of this.processes) {
      if (managed.process.killed) {
        this.processes.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Kill all processes (including their children)
   */
  killAll(): number {
    let killed = 0;
    for (const managed of this.processes.values()) {
      try {
        // Kill entire process group (negative PID kills all children)
        try {
          process.kill(-managed.pid, 'SIGTERM');
        } catch {
          managed.process.kill('SIGTERM');
        }
        killed++;
      } catch {
        // Ignore
      }
    }

    // Force kill any remaining after 1 second
    setTimeout(() => {
      for (const managed of this.processes.values()) {
        if (!managed.process.killed) {
          try {
            process.kill(-managed.pid, 'SIGKILL');
          } catch {
            try {
              managed.process.kill('SIGKILL');
            } catch {
              // Ignore
            }
          }
        }
      }
    }, 1000);

    this.processes.clear();
    return killed;
  }

  /**
   * Kill all slashbot processes system-wide (including this one)
   */
  async killAllSlashbotInstances(): Promise<number> {
    try {
      // Use pgrep to find all slashbot processes
      const pgrep = spawn('pgrep', ['-f', 'slashbot'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let pids: number[] = [];
      let stderr = '';

      pgrep.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n').filter(l => l.trim());
        pids.push(...lines.map(l => parseInt(l.trim())).filter(n => !isNaN(n)));
      });

      pgrep.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      await new Promise<void>((resolve, reject) => {
        pgrep.on('close', (code) => {
          if (code === 0 || code === 1) { // 1 means no processes found
            resolve();
          } else {
            reject(new Error(`pgrep failed: ${stderr}`));
          }
        });
        pgrep.on('error', reject);
      });

      // Filter out our own process
      pids = pids.filter(pid => pid !== process.pid);

      let killed = 0;
      for (const pid of pids) {
        try {
          // Kill process group to kill children too
          process.kill(-pid, 'SIGTERM');
          killed++;
        } catch {
          try {
            // Fallback to killing just the process
            process.kill(pid, 'SIGTERM');
            killed++;
          } catch {
            // Process might already be dead
          }
        }
      }

      // Force kill any remaining after 2 seconds
      if (killed > 0) {
        setTimeout(() => {
          for (const pid of pids) {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch {
              try {
                process.kill(pid, 'SIGKILL');
              } catch {
                // Ignore
              }
            }
          }
        }, 2000);
      }

      return killed;
    } catch {
      // Fallback: try to use ps command
      try {
        const ps = spawn('ps', ['aux'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        let stderr = '';

        ps.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });

        ps.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        await new Promise<void>((resolve, reject) => {
          ps.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`ps failed: ${stderr}`));
            }
          });
          ps.on('error', reject);
        });

        // Parse ps output to find slashbot processes
        const lines = output.split('\n');
        const pids: number[] = [];

        for (const line of lines) {
          if (line.includes('slashbot') && !line.includes('ps aux')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[1]);
            if (!isNaN(pid) && pid !== process.pid) {
              pids.push(pid);
            }
          }
        }

        let killed = 0;
        for (const pid of pids) {
          try {
            process.kill(-pid, 'SIGTERM');
            killed++;
          } catch {
            try {
              process.kill(pid, 'SIGTERM');
              killed++;
            } catch {
              // Ignore
            }
          }
        }

        // Force kill after 2 seconds
        if (killed > 0) {
          setTimeout(() => {
            for (const pid of pids) {
              try {
                process.kill(-pid, 'SIGKILL');
              } catch {
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {
                  // Ignore
                }
              }
            }
          }, 2000);
        }

        return killed;
      } catch {
        return 0;
      }
    }
  }

  private formatUptime(startedAt: Date): string {
    const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
}

// Singleton instance
export const processManager = new ProcessManager();
