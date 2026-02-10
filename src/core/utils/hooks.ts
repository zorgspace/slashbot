import * as path from 'path';
import * as fs from 'fs';
import { display } from '../ui';

export class HooksManager {
  private hooks: Record<string, string[]> = {};
  private hookTimeout: number = 5000;

  async load(cwd: string = process.cwd()): Promise<void> {
    try {
      const settingsPath = path.join(cwd, 'settings.json');
      if (!fs.existsSync(settingsPath)) return;
      const settingsStr = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(settingsStr);
      this.hooks = settings.hooks || {};
      this.hookTimeout = settings.hookTimeout || 5000;
    } catch (e) {
      display.warning(`Hooks load failed: ${String(e)}`);
    }
  }

  async trigger(event: string, data?: any): Promise<void> {
    const cmds = this.hooks[event] || [];
    for (const cmd of cmds) {
      try {
        display.muted(`[HOOK ${event}] ${cmd}`);
        const proc = Bun.spawn(['bash', '-c', cmd], {
          cwd: process.cwd(),
          env: process.env,
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        });
        await Promise.race([
          proc.exited,
          new Promise<void>((_, reject) =>
            setTimeout(() => {
              proc.kill();
              reject(new Error('Hook timeout'));
            }, this.hookTimeout),
          ),
        ]);
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          display.warning(`Hook exited ${exitCode}: ${cmd}`);
        }
      } catch (e) {
        display.warning(`Hook exec error [${event}]: ${String(e)}`);
      }
    }
  }
}
