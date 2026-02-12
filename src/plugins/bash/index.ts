/**
 * Core Bash Plugin - Shell command execution
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
  KernelHookContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { display } from '../../core/ui';
import { executeBash, executeExec } from './executors';
import { getBashParserConfigs } from './parser';
import { BASH_PROMPT } from './prompt';
import { getBashToolContributions } from './tools';
import { processManager } from './services/ProcessManager';
import { TYPES } from '../../core/di/types';
import {
  ALLOWED_GIT_COMMANDS,
  DANGEROUS_COMMANDS,
  DANGEROUS_PATTERNS,
} from '../../core/config/constants';

interface CommandValidationResult {
  blocked: boolean;
  blockedReason?: string;
  warnings: string[];
}

function validateCommandSecurity(command: string): CommandValidationResult {
  const normalized = command.trim().toLowerCase();

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (normalized.includes(dangerous.toLowerCase())) {
      return {
        blocked: true,
        blockedReason: `matches dangerous pattern "${dangerous}"`,
        warnings: [],
      };
    }
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        blocked: true,
        blockedReason: `matches blocked command rule "${pattern.source}"`,
        warnings: [],
      };
    }
  }

  const warnings: string[] = [];

  if (/^\s*sudo\b/.test(command)) {
    warnings.push('Using sudo can modify privileged system resources.');
  }

  if (/\b(curl|wget)\b[\s\S]*\|\s*(bash|sh)\b/.test(normalized)) {
    warnings.push('Piping downloaded scripts directly into a shell is risky.');
  }

  if (/^\s*git\s+/.test(command)) {
    const subcommandMatch = command.trim().match(/^git\s+([a-zA-Z-]+)/);
    const subcommand = subcommandMatch?.[1]?.toLowerCase();
    if (
      subcommand &&
      !ALLOWED_GIT_COMMANDS.includes(subcommand as (typeof ALLOWED_GIT_COMMANDS)[number])
    ) {
      warnings.push(`Git subcommand "${subcommand}" is outside the safe allowlist.`);
    }
  }

  return { blocked: false, warnings };
}

export class BashPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.bash',
    name: 'Bash',
    version: '1.0.0',
    category: 'core',
    description: 'Shell command execution (bash, exec)',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;

    // Self-register ProcessManager in DI
    context.container.bind(TYPES.ProcessManager).toConstantValue(processManager);

    for (const config of getBashParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    const onBash = async (
      command: string,
      options?: { timeout?: number; runInBackground?: boolean },
    ) => {
      const { TYPES } = await import('../../core/di/types');
      const codeEditor = context.container.get<any>(TYPES.CodeEditor);
      const { display } = await import('../../core/ui');
      const workDir = codeEditor.getWorkDir();

      // Security check
      const security = validateCommandSecurity(command);
      if (security.blocked) {
        display.errorText(`[SECURITY] Command blocked: ${security.blockedReason}`);
        return `Command blocked: ${security.blockedReason}`;
      }
      if (security.warnings.length > 0) {
        security.warnings.forEach((w: string) => display.warningText(`[SECURITY] ${w}`));
      }

      // Background execution
      if (options?.runInBackground) {
        const { processManager } = await import('./services/ProcessManager');
        const managed = processManager.spawn(command, workDir);
        await new Promise(resolve => setTimeout(resolve, 1500));
        const output = processManager.getOutput(managed.id, 10);
        let result = `Background process started:\n- ID: ${managed.id}\n- PID: ${managed.pid}\n- Command: ${command}`;
        if (output.length > 0) {
          result += `\n- Initial output:\n${output.join('\n')}`;
        }
        result += `\n\nUser can run /ps to list processes, /kill ${managed.id} to stop.`;
        return result;
      }

      // Interactive commands
      const needsInteractive = /^sudo\s|^ssh\s|passwd|read\s+-/.test(command);
      const isSlashbotExec = /\bslashbot\b|bun\s+run\s+(dev|start)/.test(command);
      const extraEnv: Record<string, string> = {};
      if (isSlashbotExec) {
        if (!options?.timeout) {
          options = { ...options, timeout: 5000 };
        }
        extraEnv.SLASHBOT_NON_INTERACTIVE = '1';
      }

      if (needsInteractive) {
        const { spawn } = await import('child_process');
        return new Promise<string>(resolve => {
          const child = spawn('bash', ['-lc', command], {
            cwd: workDir,
            stdio: 'inherit',
            env: { ...process.env, BASH_SILENCE_DEPRECATION_WARNING: '1', ...extraEnv },
          });
          child.on('close', code =>
            resolve(code === 0 ? 'Command completed' : `Command exited with code ${code}`),
          );
          child.on('error', err => resolve(`Error: ${err.message}`));
        });
      }

      // Normal execution — capture output only, display via bashResult()
      // Output is NOT streamed to stdout/stderr to avoid corrupting the TUI layout.
      try {
        const { spawn } = await import('child_process');
        const timeout = options?.timeout || 30000;

        return new Promise<string>(resolve => {
          let stdout = '';
          let stderr = '';
          let killed = false;

          const child = spawn(command, {
            shell: '/bin/bash',
            cwd: workDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              BASH_SILENCE_DEPRECATION_WARNING: '1',
              TERM: 'dumb',
              ...extraEnv,
            },
          });

          const timer = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {}
            }, 2000);
          }, timeout);

          child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          child.on('close', code => {
            clearTimeout(timer);
            if (killed) resolve(`Error: Command timed out after ${timeout}ms`);
            else if (code !== 0) {
              const output = stderr || stdout || `exit code ${code}`;
              resolve(`Error: Command failed with code ${code}\n${output}`);
            } else resolve(stdout || stderr || 'OK');
          });
          child.on('error', err => {
            clearTimeout(timer);
            resolve(`Error: ${err.message}`);
          });
        });
      } catch (error: any) {
        return `Error: ${error.message || error}`;
      }
    };

    return [
      {
        type: 'bash',
        tagName: 'bash',
        handler: { onBash: onBash },
        execute: executeBash,
      },
      {
        type: 'exec',
        tagName: 'exec',
        handler: { onExec: async (command: string) => onBash(command) },
        execute: executeExec,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getBashToolContributions();
  }

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'shutdown:before',
        order: 20,
        handler: () => {
          const killed = processManager.killAll();
          if (killed > 0) {
            display.muted(`[Process] Killed ${killed} background process(es)`);
          }
        },
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.bash.tools',
        title: 'Tools Reference',
        priority: 10,
        content: BASH_PROMPT,
      },
    ];
  }
}
