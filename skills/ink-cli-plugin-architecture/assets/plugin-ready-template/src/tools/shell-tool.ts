import { spawn } from 'node:child_process';
import type { ToolAdapter, ToolResult } from '../core/contracts.js';

export const shellTool: ToolAdapter = {
  id: 'shell',
  async execute(args: string[]): Promise<ToolResult> {
    const [command, ...commandArgs] = args;
    if (!command) {
      return {
        code: 1,
        stdout: '',
        stderr: 'Missing command to run.',
        hint: 'Use: shell <command> [args...]',
      };
    }

    return new Promise(resolve => {
      const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });
      child.stderr.on('data', chunk => {
        stderr += String(chunk);
      });

      child.on('error', error => {
        resolve({
          code: 1,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          hint: `Verify that '${command}' is installed and on PATH.`,
        });
      });

      child.on('close', code => {
        resolve({
          code: code ?? 1,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        });
      });
    });
  },
};
