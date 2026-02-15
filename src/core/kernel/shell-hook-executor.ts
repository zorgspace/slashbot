import { spawn } from 'node:child_process';
import type { HookExecutionContext } from './contracts.js';

export interface ShellHookOptions {
  command: string;
  event: string;
  matcher?: string;
  timeoutMs: number;
  cwd?: string;
}

export function createShellHookHandler<T extends Record<string, unknown>>(
  options: ShellHookOptions
): (payload: Readonly<T>, context: HookExecutionContext) => Promise<Partial<T> | void> {
  return async (payload) => {
    const payloadJson = JSON.stringify(payload);

    return new Promise<Partial<T> | void>((resolve, reject) => {
      const child = spawn('bash', ['-c', options.command], {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SLASHBOT_HOOK_EVENT: options.event,
          SLASHBOT_HOOK_MATCHER: options.matcher ?? '',
          SLASHBOT_PAYLOAD: payloadJson
        }
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Shell hook timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdin.write(payloadJson);
      child.stdin.end();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Shell hook failed to spawn: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          reject(new Error(`Shell hook exited with status ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve();
          return;
        }

        try {
          const parsed = JSON.parse(trimmed) as Partial<T>;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            resolve(parsed);
          } else {
            resolve();
          }
        } catch {
          // Non-JSON stdout is ignored (informational output)
          resolve();
        }
      });
    });
  };
}
