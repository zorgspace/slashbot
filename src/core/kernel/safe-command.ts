import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeConfig, ToolResult } from './contracts.js';

export interface ExecuteShellInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  approved?: boolean;
}

function isRisky(command: string, config: RuntimeConfig): boolean {
  return config.commandSafety.riskyCommands.includes(command);
}

/**
 * Check whether a command binary exists on PATH.
 * Returns true for absolute paths that exist or binaries found in $PATH dirs.
 */
export function commandExists(command: string): boolean {
  if (command.includes('/')) return existsSync(command);
  const dirs = (process.env.PATH ?? '').split(':');
  return dirs.some((dir) => {
    try { return existsSync(join(dir, command)); } catch { return false; }
  });
}

function commandNotFoundResult(command: string): ToolResult {
  return {
    ok: false,
    error: {
      code: 'COMMAND_NOT_FOUND',
      message: `Command not found: "${command}" is not installed on this system.`,
      hint: `The binary "${command}" does not exist in PATH. Use an alternative command that is available (e.g. "grep" instead of "rg", "find" instead of "fd"). Do not retry the same command.`,
    },
  };
}

export async function executeCommandSafely(
  input: ExecuteShellInput,
  config: RuntimeConfig
): Promise<ToolResult> {
  const args = input.args ?? [];
  if (config.commandSafety.requireExplicitApproval && isRisky(input.command, config) && !input.approved) {
    return {
      ok: false,
      error: {
        code: 'APPROVAL_REQUIRED',
        message: `Command requires explicit approval: ${input.command}`,
        hint: 'Explain the risk to the user and ask for explicit confirmation (e.g., "yes" to approve). Only then set approved=true and retry. Do not assume approval.'
      }
    };
  }

  if (!commandExists(input.command)) {
    return commandNotFoundResult(input.command);
  }

  const timeoutMs = input.timeoutMs ?? config.commandSafety.defaultTimeoutMs;

  return new Promise<ToolResult>((resolve) => {
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        ok: false,
        error: {
          code: 'COMMAND_TIMEOUT',
          message: `Command timed out after ${timeoutMs}ms`
        },
        metadata: {
          stdout,
          stderr
        }
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        resolve(commandNotFoundResult(input.command));
      } else {
        resolve({
          ok: false,
          error: {
            code: 'SPAWN_ERROR',
            message: `Failed to spawn command: ${err.message}`,
          },
        });
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const MAX_OUTPUT = 10_000;
      const truncatedStdout = stdout.length > MAX_OUTPUT
        ? `${stdout.slice(0, MAX_OUTPUT)}\n... (truncated, ${stdout.length - MAX_OUTPUT} more chars)`
        : stdout;
      const truncatedStderr = stderr.length > MAX_OUTPUT
        ? `${stderr.slice(0, MAX_OUTPUT)}\n... (truncated, ${stderr.length - MAX_OUTPUT} more chars)`
        : stderr;
      resolve({
        ok: code === 0,
        output: truncatedStdout,
        error:
          code === 0
            ? undefined
            : {
                code: 'COMMAND_FAILED',
                message: `Command exited with status ${code}`
              },
        metadata: {
          stdout: truncatedStdout,
          stderr: truncatedStderr,
          code: code ?? -1
        }
      });
    });
  });
}
