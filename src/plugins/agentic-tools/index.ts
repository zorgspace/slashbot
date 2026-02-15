import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { JsonValue, RuntimeConfig, SlashbotPlugin } from '../../core/kernel/contracts.js';
import { commandExists, executeCommandSafely } from '../../core/kernel/safe-command.js';
import type { SpawnBridge } from '../../core/kernel/spawn-bridge.js';
import type { ApprovalBridge } from '../../core/kernel/approval-bridge.js';
import { asObject, asNonEmptyString as asString } from '../utils.js';

const RISKY_PATTERNS = [
  /\brm\s+(-[^\s]*\s+)*\//,  // rm with absolute paths
  /\brm\s+-[^\s]*r/,          // rm -r (recursive)
  /\bgit\s+push\s+--force/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-f/,
  /\bdd\s+/,
  /\bmkfs\b/,
  /\bchmod\s+777\b/,
  /\bcurl\b.*\|\s*(?:ba)?sh/,
  /\bwget\b.*\|\s*(?:ba)?sh/,
];

function isRiskyCommand(command: string, args: string[]): boolean {
  const fullCommand = [command, ...args].join(' ');
  return RISKY_PATTERNS.some((pattern) => pattern.test(fullCommand));
}

function asText(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string field: ${name}`);
  }
  return value;
}

function asOptionalNonEmptyString(value: JsonValue | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected string field: ${name}`);
  }
  return value.trim();
}

function normalizeArgs(value: JsonValue | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== 'string')) {
      throw new Error('Expected string[] field: args');
    }
    return value as string[];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  }
  throw new Error('Expected string[] field: args');
}

async function resolvePath(workspaceRoot: string, inputPath: string): Promise<string> {
  // Expand ~ to home directory (Node's resolve doesn't do this)
  const expanded = inputPath.startsWith('~/') || inputPath === '~'
    ? inputPath.replace('~', process.env.HOME ?? '/root')
    : inputPath;
  const absolute = resolve(workspaceRoot, expanded);
  try {
    await fs.access(absolute);
    return absolute;
  } catch {
    // If not found, try under src/ — LLMs often omit the src/ prefix
    const withSrc = resolve(workspaceRoot, 'src', inputPath);
    try {
      await fs.access(withSrc);
      return withSrc;
    } catch {
      // fall through to original path so the caller gets the expected ENOENT
    }
    return absolute;
  }
}

/**
 * Agentic Tools plugin — sandbox tools used by the agentic loop.
 *
 * Tools:
 *  - `shell.exec`  — Execute a subprocess with safety checks (risky-command gating, SpawnBridge TUI rendering).
 *  - `fs.read`     — Read any file on the system.
 *  - `fs.write`    — Create / overwrite any file on the system.
 *  - `fs.patch`    — Find-and-replace inside any existing file on the system.
 */
export function createAgenticToolsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: 'slashbot.agentic.tools',
      name: 'Slashbot Agentic Tools',
      version: '0.1.0',
      main: 'bundled',
      description: 'Shell and filesystem tools for agentic execution loops'
    },
    setup: (context) => {
      const config = context.getService<RuntimeConfig>('kernel.config');
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot');
      if (!config || !workspaceRoot) {
        throw new Error('kernel.config and kernel.workspaceRoot services are required');
      }

      context.registerTool({
        id: 'shell.exec',
        title: 'Shell',
        pluginId: 'slashbot.agentic.tools',
        description: 'Execute a shell command with full system access — NOT restricted to workspace. Use to read/write any file on the system, manage packages, inspect processes, edit configs outside workspace, etc.',
        parameters: z.object({
          command: z.string().optional().describe('Command to run. Prefer a full command line string (e.g. "npm test" or "ls -la").'),
          args: z.union([z.array(z.string()), z.string()]).optional().describe('Command arguments as string[] (or a single space-separated string)'),
          cwd: z.string().optional().describe('Working directory'),
          timeoutMs: z.number().optional().describe('Timeout in ms (min 15000). Omit to use default (60s).'),
          approved: z.boolean().optional().describe('Set true to confirm execution of risky commands'),
        }),
        execute: async (args, callContext) => {
          try {
            const input = asObject(args);
            const inlineCommand = asOptionalNonEmptyString(input.command, 'command');
            // Backward compatibility for older prompts that still send `cmd`.
            const legacyShellCommand = asOptionalNonEmptyString(input.cmd, 'cmd');
            const parsedArgs = normalizeArgs(input.args);
            const rawArgs = input.args;

            let command: string;
            let resolvedArgs: string[];
            let displayCommand: string;

            if (inlineCommand) {
              // Always route through sh — the LLM should not pick the shell binary.
              const fullCmd = parsedArgs.length > 0
                ? [inlineCommand, ...parsedArgs].join(' ')
                : inlineCommand;
              command = 'sh';
              resolvedArgs = ['-lc', fullCmd];
              displayCommand = fullCmd;
            } else if (legacyShellCommand) {
              command = 'sh';
              resolvedArgs = ['-lc', legacyShellCommand];
              displayCommand = legacyShellCommand;
            } else if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
              // Compatibility for environments that accidentally pass command line in args.
              command = 'sh';
              resolvedArgs = ['-lc', rawArgs.trim()];
              displayCommand = rawArgs.trim();
            } else if (parsedArgs.length > 0) {
              // Compatibility for environments that pass argv only.
              command = 'sh';
              resolvedArgs = ['-lc', parsedArgs.join(' ')];
              displayCommand = parsedArgs.join(' ');
            } else {
              throw new Error('Expected string field: command');
            }

            const cwd = typeof input.cwd === 'string' && input.cwd.length > 0
              ? await resolvePath(workspaceRoot, input.cwd)
              : workspaceRoot;
            const rawTimeout = typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined;
            const timeoutMs = rawTimeout !== undefined ? Math.max(rawTimeout, 15_000) : undefined;
            const approvedFlag = input.approved === true;

            // Early-exit if the binary is missing — prevents ENOENT crash in ink-spawn
            if (!commandExists(command)) {
              return {
                ok: false,
                error: {
                  code: 'COMMAND_NOT_FOUND',
                  message: `Command not found: "${command}" is not installed on this system.`,
                  hint: `The binary "${command}" does not exist in PATH. Use an alternative command that is available (e.g. "grep" instead of "rg", "find" instead of "fd"). Do not retry the same command.`,
                  },
              };
            }

            let approved = approvedFlag;
            // Check risky commands and route through ApprovalBridge if needed
            if (isRiskyCommand(displayCommand, []) && !approved) {
              const approvalBridge = context.getService<ApprovalBridge>('kernel.approvalBridge');
              if (approvalBridge) {
                const approvalResult = await approvalBridge.request(displayCommand, [], cwd);
                const approvalGranted = approvalResult.ok && approvalResult.metadata?.approved === true;
                if (!approvalGranted) {
                  return approvalResult.ok
                    ? {
                        ok: false,
                        error: {
                          code: 'APPROVAL_DENIED',
                          message: `Command "${displayCommand}" was not approved.`,
                        },
                      }
                    : approvalResult;
                }
                approved = true;
              } else {
                return {
                  ok: false,
                  error: {
                    code: 'APPROVAL_REQUIRED',
                    message: `Command "${displayCommand}" is flagged as risky and requires approval. Re-submit with { "approved": true } or use an alternative approach.`,
                  },
                };
              }
            }

            // Use SpawnBridge (TUI live rendering) when available, fallback to direct spawn
            const bridge = context.getService<SpawnBridge>('kernel.spawnBridge');
            if (bridge) {
              return await bridge.request(command, resolvedArgs, cwd, timeoutMs ?? config.commandSafety.defaultTimeoutMs, callContext.abortSignal);
            }

            return await executeCommandSafely(
              { command, args: resolvedArgs, cwd, timeoutMs, approved },
              config
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: 'SHELL_EXEC_ERROR', message } };
          }
        }
      });

      context.registerTool({
        id: 'fs.read',
        title: 'Read',
        pluginId: 'slashbot.agentic.tools',
        description: 'Read any file on the system (absolute or relative to workspace)',
        parameters: z.object({
          path: z.string().describe('File path (absolute like /etc/hosts or ~/.config/... , or relative to workspace)'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const filePath = await resolvePath(workspaceRoot, asString(input.path, 'path'));
            const content = await fs.readFile(filePath, 'utf8');
            return { ok: true, output: content };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
            return { ok: false, error: { code, message } };
          }
        }
      });

      context.registerTool({
        id: 'fs.write',
        title: 'Write',
        pluginId: 'slashbot.agentic.tools',
        description: 'Create or overwrite any file on the system (absolute or relative to workspace)',
        parameters: z.object({
          path: z.string().describe('File path (absolute or relative to workspace)'),
          content: z.string().describe('File content to write'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const filePath = await resolvePath(workspaceRoot, asString(input.path, 'path'));
            const content = asText(input.content, 'content');
            await fs.mkdir(dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf8');
            return { ok: true, output: `wrote ${filePath}` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
            return { ok: false, error: { code, message } };
          }
        }
      });

      context.registerTool({
        id: 'fs.patch',
        title: 'Patch',
        pluginId: 'slashbot.agentic.tools',
        description: 'Patch any file on the system with find/replace (absolute or relative to workspace)',
        parameters: z.object({
          path: z.string().describe('File path (absolute or relative to workspace)'),
          find: z.string().describe('Text to find'),
          replace: z.string().describe('Replacement text'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const filePath = await resolvePath(workspaceRoot, asString(input.path, 'path'));
            const find = asString(input.find, 'find');
            const replace = asText(input.replace, 'replace');
            const current = await fs.readFile(filePath, 'utf8');
            if (!current.includes(find)) {
              return { ok: false, error: { code: 'PATCH_FIND_NOT_FOUND', message: `Target text not found in ${filePath}` } };
            }
            await fs.writeFile(filePath, current.replace(find, replace), 'utf8');
            return { ok: true, output: `patched ${filePath}` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
            return { ok: false, error: { code, message } };
          }
        }
      });
    }
  };
}

export { createAgenticToolsPlugin as createPlugin };
