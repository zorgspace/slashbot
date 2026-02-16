import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { ChannelDefinition, JsonValue, SlashbotPlugin, StructuredLogger } from '@slashbot/plugin-sdk';
import type { RuntimeConfig } from '../../core/kernel/contracts.js';
import type { ChannelRegistry, ProviderRegistry } from '../../core/kernel/registries.js';
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { AuthProfileRouter } from '../../core/providers/auth-router.js';
import type { TokenModeProxyAuthService } from '../../core/agentic/llm/types.js';
import { KernelLlmAdapter } from '../../core/agentic/llm/adapter.js';
import { SubagentManager } from '../services/subagent-manager.js';
import { commandExists, executeCommandSafely } from '../../core/kernel/safe-command.js';

import * as readlinePromises from 'node:readline/promises';
import { asObject, asNonEmptyString as asString } from '../utils.js';

const HARD_BLOCKED_PATTERNS = [
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,   // fork bomb :(){ :|:& };:
  /(?:^|[;&|]\s*)(shutdown|reboot|poweroff|halt)\b/,  // only as command, not in args
  />\s*\/dev\/sd[a-z]/,                            // direct disk writes
  /(?:^|[;&|]\s*)(format|diskpart)\b/,                // Windows compat (only as command, not in args)
];

const RISKY_PATTERNS = [
  /\brm\s+(-[^\s]*\s+)*\//,  // rm with absolute paths
  /\brm\s+-[^\s]*r/,          // rm -r (recursive)
  /\bgit\s+push\s+--force/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-f/,
  /\bdd\s+/,
  /\bmkfs\b/,
  /\bchmod\s+777\b/,
];

function isHardBlocked(command: string): boolean {
  return HARD_BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

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
 *  - `shell.exec`  — Execute a subprocess with safety checks (risky-command gating, piped stdio).
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

            // Hard-blocked commands — not overridable even with approved: true
            if (isHardBlocked(displayCommand)) {
              return {
                ok: false,
                error: {
                  code: 'HARD_BLOCKED',
                  message: `Command is permanently blocked for safety: "${displayCommand}"`,
                  hint: 'This command pattern is hard-blocked and cannot be approved. Use a safer alternative.',
                },
              };
            }

            let approved = approvedFlag;
            if (isRiskyCommand(displayCommand, []) && !approved) {
              return {
                ok: false,
                error: {
                  code: 'APPROVAL_REQUIRED',
                  message: `Risky command requires explicit approval: "${displayCommand}"`,
                  hint: `To execute, first ask the user for confirmation in your next response, then re-call shell_exec with the same parameters plus {approved: true}.`,
                },
              };
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
            const occurrences = current.split(find).length - 1;
            if (occurrences > 1) {
              return { ok: false, error: { code: 'PATCH_AMBIGUOUS', message: `Found ${occurrences} occurrences of the target text in ${filePath}. Provide more surrounding context to make the match unique.` } };
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

      context.registerTool({
        id: 'fs.append',
        title: 'Append',
        pluginId: 'slashbot.agentic.tools',
        description: 'Append content to any file on the system (creates if missing). Uses append mode — avoids read+concat+write cycle for logs and notes.',
        parameters: z.object({
          path: z.string().describe('File path (absolute or relative to workspace)'),
          content: z.string().describe('Content to append'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const filePath = await resolvePath(workspaceRoot, asString(input.path, 'path'));
            const content = asText(input.content, 'content');
            await fs.mkdir(dirname(filePath), { recursive: true });
            await fs.appendFile(filePath, content, 'utf8');
            return { ok: true, output: `appended to ${filePath}` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
            return { ok: false, error: { code, message } };
          }
        }
      });

      context.registerTool({
        id: 'fs.list',
        title: 'List',
        pluginId: 'slashbot.agentic.tools',
        description: 'List directory contents. Returns entries prefixed with DIR: or FILE: for each item.',
        parameters: z.object({
          path: z.string().describe('Directory path (absolute or relative to workspace)'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const dirPath = await resolvePath(workspaceRoot, asString(input.path, 'path'));
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const lines = entries.map((entry) => {
              const prefix = entry.isDirectory() ? 'DIR' : 'FILE';
              return `${prefix}: ${entry.name}`;
            });
            return { ok: true, output: lines.join('\n') };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
            return { ok: false, error: { code, message } };
          }
        }
      });

      context.registerTool({
        id: 'message',
        title: 'Message',
        pluginId: 'slashbot.agentic.tools',
        description: 'Send a message to a registered channel. Defaults to CLI. For connectors (Telegram, Discord), chatId is required.',
        parameters: z.object({
          content: z.string().describe('Message content to send'),
          channel: z.string().optional().describe('Channel ID (e.g. "telegram", "discord"). Defaults to "cli".'),
          chatId: z.string().optional().describe('Chat/conversation ID — required for connector channels (Telegram, Discord, etc.)'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const content = asText(input.content, 'content');
            const channelId = asOptionalNonEmptyString(input.channel, 'channel') ?? 'cli';
            const chatId = asOptionalNonEmptyString(input.chatId, 'chatId');

            const channelsRegistry = context.getService<ChannelRegistry>('kernel.channels.registry');
            if (!channelsRegistry) {
              return { ok: false, error: { code: 'NO_CHANNELS', message: 'Channel registry not available' } };
            }

            const target = channelsRegistry.get(channelId);
            if (!target) {
              const available = channelsRegistry.list().map((c) => c.id).join(', ');
              return { ok: false, error: { code: 'CHANNEL_NOT_FOUND', message: `Channel "${channelId}" not found. Available: ${available}` } };
            }

            // Connector channels (non-CLI) require a chatId
            if (target.connector && channelId !== 'cli' && !chatId) {
              return { ok: false, error: { code: 'CHAT_ID_REQUIRED', message: `Channel "${channelId}" is a connector and requires a chatId parameter.` } };
            }

            const payload = chatId ? { text: content, chatId } : content;
            await target.send(payload as JsonValue);
            return { ok: true, output: `Message sent via ${target.id}` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: 'MESSAGE_ERROR', message } };
          }
        }
      });

      // ── Spawn tool (async subagent) ──────────────────────────────────
      let subagentManager: SubagentManager | undefined;

      const getSubagentManager = (): SubagentManager | undefined => {
        if (subagentManager) return subagentManager;
        const kernel = context.getService<SlashbotKernel>('kernel.instance');
        const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
        const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
        const logger = context.getService<StructuredLogger>('kernel.logger');
        if (!kernel || !authRouter || !providers || !logger) return undefined;
        const llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
        const assemblePrompt = context.getService<() => Promise<string>>('kernel.assemblePrompt');
        if (!assemblePrompt) return undefined;
        const channelsRegistry = context.getService<ChannelRegistry>('kernel.channels.registry');
        const firstChannel = channelsRegistry?.list()[0];
        const getAvailableTools = () =>
          kernel.tools.list().map((t) => ({ id: t.id, title: t.title, description: t.description }));
        subagentManager = new SubagentManager(llm, assemblePrompt, logger, firstChannel, getAvailableTools);

        // Expose as a kernel service so connectors can retrieve pending results
        context.registerService({
          id: 'agentic.subagentManager',
          pluginId: 'slashbot.agentic.tools',
          description: 'Subagent manager for background tasks',
          implementation: subagentManager,
        });

        return subagentManager;
      };

      context.registerTool({
        id: 'spawn',
        title: 'Spawn',
        pluginId: 'slashbot.agentic.tools',
        description: 'Spawn a subagent to handle a subtask. Blocks until the subagent completes and returns its result. Multiple spawn calls in the same step run in parallel.',
        parameters: z.object({
          task: z.string().describe('Task description for the subagent'),
        }),
        execute: async (args, callContext) => {
          try {
            const input = asObject(args);
            const task = asText(input.task, 'task');
            const manager = getSubagentManager();
            if (!manager) {
              return { ok: false, error: { code: 'SPAWN_UNAVAILABLE', message: 'Subagent manager not available — LLM provider not configured.' } };
            }
            const result = await manager.spawn(task, callContext.sessionId);
            if (result.status === 'error') {
              return { ok: false, error: { code: 'SUBAGENT_ERROR', message: result.error ?? 'Subagent failed' } };
            }
            return { ok: true, output: result.result ?? '(no output)' };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: 'SPAWN_ERROR', message } };
          }
        }
      });
    }
  };
}

export { createAgenticToolsPlugin as createPlugin };
