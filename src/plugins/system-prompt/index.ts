import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { hostname, platform, arch, userInfo, release } from 'node:os';
import type { SlashbotPlugin, ToolDefinition } from '@slashbot/plugin-sdk';
import type { ToolRegistry } from '../../core/kernel/registries.js';
import { initWorkspace } from '../../core/workspace-init.js';

const PLUGIN_ID = 'slashbot.system.prompt';
const WORKSPACE_CONTEXT_CACHE_TTL_MS = 5_000;

const TREE_IGNORE = new Set([
  'node_modules', '.git', '.slashbot', 'dist', 'build', 'coverage',
  '.next', '.cache', '.turbo', '__pycache__', '.venv', 'venv',
]);
const TREE_MAX_DEPTH = 3;
const TREE_MAX_ENTRIES = 120;

/** Build a simple tree listing of the workspace (depth-limited, ignoring noise). */
async function buildFileTree(root: string): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > TREE_MAX_DEPTH || lines.length >= TREE_MAX_ENTRIES) return;

    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }

    // Stat each entry to determine if it's a directory
    const typed: Array<{ name: string; isDir: boolean }> = [];
    for (const name of names) {
      if (name.startsWith('.') && depth === 0 && name !== '.slashbot') continue;
      if (TREE_IGNORE.has(name)) continue;
      try {
        const stat = await fs.stat(join(dir, name));
        typed.push({ name, isDir: stat.isDirectory() });
      } catch {
        typed.push({ name, isDir: false });
      }
    }

    // Sort: directories first, then alphabetical
    typed.sort((a, b) => {
      const aDir = a.isDir ? 0 : 1;
      const bDir = b.isDir ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name);
    });

    for (let i = 0; i < typed.length; i++) {
      if (lines.length >= TREE_MAX_ENTRIES) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }

      const entry = typed[i];
      const isLast = i === typed.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (entry.isDir) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        await walk(join(dir, entry.name), `${prefix}${childPrefix}`, depth + 1);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  }

  await walk(root, '', 0);
  return lines.join('\n');
}

/** Collect system environment info (cached — called once then reused). */
function collectSystemInfo(): string {
  const lines: string[] = [];

  lines.push(`- **Hostname**: ${hostname()}`);
  lines.push(`- **Platform**: ${platform()} ${arch()}`);
  lines.push(`- **Kernel**: ${release()}`);
  lines.push(`- **User**: ${userInfo().username}`);
  lines.push(`- **Home**: ${userInfo().homedir}`);
  lines.push(`- **CWD**: ${process.cwd()}`);
  lines.push(`- **Shell**: ${process.env.SHELL ?? 'unknown'}`);
  lines.push(`- **Node**: ${process.version}`);

  // Distro (Linux only)
  try {
    const osRelease = execSync('cat /etc/os-release 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
    const prettyName = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1];
    if (prettyName) lines.push(`- **Distro**: ${prettyName}`);
  } catch { /* not linux or not available */ }

  // Desktop environment
  const de = process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION;
  if (de) lines.push(`- **Desktop**: ${de}`);

  // Terminal emulator
  const term = process.env.TERM_PROGRAM || process.env.TERMINAL || process.env.TERM;
  if (term) lines.push(`- **Terminal**: ${term}`);

  // Package manager
  try {
    if (execSync('which apt 2>/dev/null', { encoding: 'utf8', timeout: 1000 }).trim()) {
      lines.push('- **Package manager**: apt');
    }
  } catch {
    try {
      if (execSync('which dnf 2>/dev/null', { encoding: 'utf8', timeout: 1000 }).trim()) {
        lines.push('- **Package manager**: dnf');
      }
    } catch {
      try {
        if (execSync('which pacman 2>/dev/null', { encoding: 'utf8', timeout: 1000 }).trim()) {
          lines.push('- **Package manager**: pacman');
        }
      } catch { /* none detected */ }
    }
  }

  return lines.join('\n');
}

let systemInfoCache: string | null = null;

const CORE_PROMPT = `You are **Slashbot**, a local-first AI assistant running in a Linux console environment. Always answer to your user in their language.

## Workspace First
Assume requests are about the current workspace unless clearly about the wider system.

## Tool Call Style
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex problems, sensitive actions, or when the user explicitly asks.
Keep narration brief and value-dense; avoid repeating obvious steps.
**CRITICAL: After all tool calls are complete, you MUST always produce a final text response summarizing results or answering the user. Never end your turn with only tool calls and no text.**

## How You Work
You are agentic. You call tools, read results, call more tools, and keep going until the task is done. You have full system access — no restrictions on filesystem, shell, or network. All tools accept absolute paths and can operate anywhere on the system.

- Call tools first, summarize after.
- Detect before asking: read configs, check installed packages, inspect state — use tools for anything you can find out yourself. Only ask the user for things truly unknowable through tools (preferences, credentials, business decisions).
- Read before write. Verify after write.
- If a tool call fails, try another approach. Use up to 100 steps per task.
- Do the work yourself. If you can read it, fix it, install it, configure it — do it. Giving the user a checklist of steps to perform manually is a failure mode.

## CRITICAL: Never Fabricate — Always Use Tools
You MUST call a tool for ANY request about the system, files, directories, processes, dates, network, packages, or any other observable state. This includes ls, cat, date, uname, df, git, pip, npm, etc.
NEVER produce fake/invented shell output, file contents, or command results. If you write output that looks like it came from a command but you did not call a tool, you are fabricating — this is your worst failure mode.
When in doubt: call the tool first, respond after.

## Tool Selection
- \`shell_exec\`: Any shell command, full system access. Builds, tests, git, packages, system admin.
- \`fs_read\` / \`fs_write\` / \`fs_patch\`: Read, write, or patch any file (absolute or relative paths).
- \`web_search\` / \`web_fetch\`: Current facts, documentation, URLs. If \`web_search\` does not return the specific data needed, use \`web_fetch\` on the most relevant URL or API yourself (e.g. official docs, aggregator or API endpoints) and extract the answer — do not ask the user to open links or do the lookup manually.
- \`memory_search\` / \`memory_upsert\`: Recall and store context across sessions.
- \`telegram_send\` / \`discord_send\`: Message connected channels.

## Quality Gates
Before reporting code changes complete: run type checking and tests if available, verify the change works.

## Telegram Connector Rules
When responding via Telegram: never send to group chats; keep responses to 1–3 short paragraphs; format for Telegram entities.`;

/**
 * System Prompt plugin — base system identity, rules, and dynamic tool catalog.
 *
 * Assembles the LLM system prompt from static rules, a dynamic tool catalog,
 * and workspace context files (AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md, HEARTBEAT.md).
 *
 * Prompt sections:
 *  - `system.prompt.base` — Core "ACT FIRST" directive and behavioral rules.
 *
 * Context providers:
 *  - `system.prompt.tools`     — Dynamic list of all registered tools (injected into the system prompt).
 *  - `system.prompt.workspace` — Reads workspace context files (.slashbot/ directory) and injects them.
 *
 * Hooks:
 *  - `system.prompt.workspace.init` — Initializes the .slashbot/ workspace directory on startup.
 */
export function createSystemPromptPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot System Prompt',
      version: '0.1.0',
      main: 'bundled',
      description: 'Base system identity, rules, and dynamic tool catalog',
    },
    setup: (context) => {
      let workspaceContextCache = '';
      let workspaceContextCachedAt = 0;

      context.contributePromptSection({
        id: 'system.prompt.base',
        pluginId: PLUGIN_ID,
        priority: 0,
        content: CORE_PROMPT,
      });

      context.contributeContextProvider({
        id: 'system.prompt.tools',
        pluginId: PLUGIN_ID,
        priority: 1,
        provide: () => {
          const toolRegistry = context.getService<ToolRegistry>('kernel.tools.registry');
          if (!toolRegistry) return '';

          const tools: ToolDefinition[] = toolRegistry.list();
          if (tools.length === 0) return '';

          // --- Flat tool catalog — only callable tools (those with parameter schemas) ---
          const lines: string[] = [
            '## Available Tools',
            'These are the tools you can call. Use them proactively — never guess or fabricate information that a tool can provide.',
          ];

          for (const t of tools) {
            // Only list tools that have parameter schemas (matching buildToolSet behavior)
            if (!t.parameters) continue;

            // Use sanitized name (dots → underscores) matching the API tool definitions
            const safeName = t.id.replace(/\./g, '_');
            let paramDesc = '';
            if ('shape' in t.parameters) {
              try {
                const shape = (t.parameters as { shape: Record<string, { description?: string; isOptional?: () => boolean }> }).shape;
                const params = Object.entries(shape)
                  .map(([key, schema]) => {
                    const opt = typeof schema.isOptional === 'function' && schema.isOptional() ? '?' : '';
                    return `${key}${opt}`;
                  })
                  .join(', ');
                if (params) paramDesc = ` (${params})`;
              } catch {
                // ignore shape extraction errors
              }
            }
            lines.push(`- ${safeName}${paramDesc}: ${t.description}`);
          }

          return lines.join('\n');
        },
      });

      context.contributeContextProvider({
        id: 'system.prompt.workspace',
        pluginId: PLUGIN_ID,
        priority: 2,
        provide: async () => {
          const now = Date.now();
          if (now - workspaceContextCachedAt < WORKSPACE_CONTEXT_CACHE_TTL_MS) {
            return workspaceContextCache;
          }

          const cwd = process.cwd();
          const slashbotDir = join(cwd, '.slashbot');
          const sections: string[] = ['## Workspace Context'];

          // System environment info (computed once, cached forever)
          if (!systemInfoCache) {
            try {
              systemInfoCache = collectSystemInfo();
            } catch {
              systemInfoCache = '';
            }
          }
          if (systemInfoCache) {
            const currentDate = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
            sections.push(`### System Environment\nYou are running on this system. Use this info directly — never ask the user for it.\n- **Current date/time**: ${currentDate}\n${systemInfoCache}`);
          }

          // File tree of the workspace
          try {
            const tree = await buildFileTree(cwd);
            if (tree) {
              sections.push(`### Workspace Files\n\`\`\`\n${tree}\n\`\`\``);
            }
          } catch {
            // ignore tree errors
          }

          // Read bootstrap files (AGENTS.md, SOUL.md, TOOLS.md)
          const bootstrapFiles: Array<[string, string]> = [
            ['AGENTS.md', 'Agent Instructions'],
            ['SOUL.md', 'Persona'],
            ['TOOLS.md', 'Tool Notes'],
          ];
          for (const [fileName, label] of bootstrapFiles) {
            try {
              const content = await fs.readFile(join(slashbotDir, fileName), 'utf8');
              if (content.trim().length > 0) {
                const truncated = content.length > 1500 ? `${content.slice(0, 1500)}\n...[truncated]` : content;
                sections.push(`### ${label} (${fileName})\n${truncated}`);
              }
            } catch {
              // file not present
            }
          }

          // Read MEMORY.md if present
          try {
            const memory = await fs.readFile(join(slashbotDir, 'MEMORY.md'), 'utf8');
            if (memory.trim().length > 0) {
              const truncated = memory.length > 2000 ? `${memory.slice(0, 2000)}\n...[truncated]` : memory;
              sections.push(`### Project Memory (MEMORY.md)\n${truncated}`);
            }
          } catch {
            // no memory file
          }

          // List available skills
          try {
            const skillsDir = join(slashbotDir, 'skills');
            const entries = await fs.readdir(skillsDir);
            const skills = entries.filter((e) => !e.startsWith('.'));
            if (skills.length > 0) {
              sections.push(`### Available Skills\n${skills.map((s) => `- ${s}`).join('\n')}`);
            }
          } catch {
            // no skills directory
          }

          // Check heartbeat
          try {
            const heartbeat = await fs.readFile(join(cwd, 'HEARTBEAT.md'), 'utf8');
            if (heartbeat.trim().length > 0) {
              const truncated = heartbeat.length > 500 ? `${heartbeat.slice(0, 500)}\n...[truncated]` : heartbeat;
              sections.push(`### Heartbeat Status\n${truncated}`);
            }
          } catch {
            // no heartbeat file
          }

          workspaceContextCache = sections.length > 1 ? sections.join('\n\n') : '';
          workspaceContextCachedAt = Date.now();
          return workspaceContextCache;
        },
      });

      // Workspace initialization on startup
      context.registerHook({
        id: 'system.prompt.workspace.init',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 5,
        handler: async () => {
          const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
          const result = await initWorkspace({ workspaceRoot });
          if (result.created.length > 0) {
            context.logger.info('Workspace initialized', { created: result.created.length });
          }
        },
      });
    },
  };
}

export { createSystemPromptPlugin as createPlugin };
