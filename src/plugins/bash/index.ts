/**
 * Core Bash Plugin - Shell command execution
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { ActionHandlers } from '../../core/actions/types';
import { registerActionParser } from '../../core/actions/parser';
import { executeBash, executeExec } from './executors';
import { getBashParserConfigs } from './parser';
import { BASH_PROMPT } from './prompt';

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
      const scheduler = context.container.get<any>(TYPES.TaskScheduler);
      const { display } = await import('../../core/ui');
      const workDir = codeEditor.getWorkDir();

      // Security check
      const security = scheduler.validateCommand(command);
      if (security.blocked) {
        display.errorText(`[SECURITY] Command blocked: ${security.blockedReason}`);
        return `Command blocked: ${security.blockedReason}`;
      }
      if (security.warnings.length > 0) {
        security.warnings.forEach((w: string) => display.warningText(`[SECURITY] ${w}`));
      }

      // Background execution
      if (options?.runInBackground) {
        const { processManager } = await import('../../core/utils/processManager');
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
