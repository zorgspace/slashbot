import { execFile, spawn } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { JsonValue, PathResolver, PluginManifest, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import type { CommandRegistry, ToolRegistry } from '@slashbot/core/kernel/registries.js';
import { clearHistory } from '@slashbot/core/history.js';
import { validateManifest } from '@slashbot/core/plugins/manifest.js';

const execFileAsync = promisify(execFile);

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'history:clear': Record<string, never>;
  }
}

interface CommandOutput {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface UpdateState {
  lastCheckedAt?: string;
  lastSeenVersion?: string;
}

const DEFAULT_BUNDLED_SOURCE = 'github:zorgspace/slashbot';
const DEFAULT_RELEASES_API = 'https://api.github.com/repos/zorgspace/slashbot/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let UPDATE_STATE_PATH = '';
const COMMAND_GUIDE: Record<string, { usage: string; when: string }> = {
  health: {
    usage: '/health',
    when: 'Use when you need a quick runtime status check.',
  },
  doctor: {
    usage: '/doctor',
    when: 'Use when behavior is broken and you want plugin failure diagnostics.',
  },
  help: {
    usage: '/help',
    when: 'Use when you need the full command/tool catalog and usage hints.',
  },
  clear: {
    usage: '/clear',
    when: 'Use when you want to reset chat history/context.',
  },
  history: {
    usage: '/history',
    when: 'Use when you want guidance about history handling in the TUI.',
  },
  plugins: {
    usage: '/plugins [list|install <github-url> [name]|remove <name>]',
    when: 'Use to list loaded/available plugins, install from GitHub, or remove an external plugin.',
  },
  update: {
    usage: '/update [--source <npm-or-github-source>]',
    when: 'Use when you want to upgrade Slashbot from bundled or checkout installs.',
  },
wallet: {
    usage: '/wallet <create|import|export|balance|send|redeem|deposit|pricing|mode|usage|unlock|lock|status> [...]',
    when: 'Use when managing the local wallet, balances, transfers, or payment mode.',
  },
  telegram: {
    usage: '/telegram <status|setup|enable|disable|chatid|groupchatid> [...]',
    when: 'Use when configuring Telegram connectivity and authorized chats.',
  },
  discord: {
    usage: '/discord <status|setup> [...]',
    when: 'Use when configuring Discord bot connectivity and channels.',
  },
  heartbeat: {
    usage: '/heartbeat <status|enable|disable|every|trigger> [...]',
    when: 'Use when controlling periodic heartbeat checks and reports.',
  },
  transcription: {
    usage: '/transcription <status|setup> [...]',
    when: 'Use when checking or configuring audio transcription support.',
  },
};

function parseFlagValue(flags: Record<string, string | boolean> | undefined, key: string): string | undefined {
  const value = flags?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function commandUsage(command: { id: string; subcommands?: string[] }): string {
  const guide = COMMAND_GUIDE[command.id];
  if (guide) return guide.usage;
  if (command.subcommands && command.subcommands.length > 0) {
    return `/${command.id} <${command.subcommands.join('|')}>`;
  }
  return `/${command.id}`;
}

function commandWhenToUse(command: { id: string; description: string }): string {
  const guide = COMMAND_GUIDE[command.id];
  if (guide) return guide.when;
  return command.description;
}

function parseEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function createSilentOutput(): CommandOutput {
  const sink = new Writable({
    write(_chunk, _encoding, callback) { callback(); }
  });
  return { stdout: sink, stderr: sink };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

async function findPackageRoot(startPath: string): Promise<string | null> {
  let current = resolve(startPath);
  while (true) {
    if (await pathExists(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function normalizeRepoSource(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  if (/^github:/i.test(trimmed)) return trimmed;
  if (/^[^@\s]+\/[^@\s]+$/.test(trimmed)) return `github:${trimmed}`;

  const ghMatch = trimmed.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?/i);
  if (ghMatch?.[1]) {
    return `github:${ghMatch[1]}`;
  }
  return null;
}

async function detectRepositorySource(packageRoot: string): Promise<string | null> {
  try {
    const raw = await fsPromises.readFile(join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { repository?: string | { url?: string } };
    if (!parsed.repository) return null;

    if (typeof parsed.repository === 'string') {
      return normalizeRepoSource(parsed.repository);
    }
    if (typeof parsed.repository.url === 'string') {
      return normalizeRepoSource(parsed.repository.url);
    }
    return null;
  } catch {
    return null;
  }
}

async function readPackageVersion(packageRoot: string): Promise<string | null> {
  try {
    const raw = await fsPromises.readFile(join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

async function loadUpdateState(): Promise<UpdateState> {
  try {
    const raw = await fsPromises.readFile(UPDATE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as UpdateState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveUpdateState(state: UpdateState): Promise<void> {
  await fsPromises.mkdir(dirname(UPDATE_STATE_PATH), { recursive: true });
  await fsPromises.writeFile(UPDATE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function shouldCheckForUpdates(state: UpdateState): boolean {
  if (!state.lastCheckedAt) return true;
  const previous = Date.parse(state.lastCheckedAt);
  if (Number.isNaN(previous)) return true;
  return Date.now() - previous >= UPDATE_CHECK_INTERVAL_MS;
}

async function fetchLatestReleaseVersion(apiUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'slashbot-updater'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json() as { tag_name?: string; name?: string };
    const candidate = payload.tag_name ?? payload.name ?? '';
    const match = candidate.match(/v?\d+\.\d+\.\d+/);
    return match ? match[0] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUpdateSources(options: {
  explicitSource?: string;
  envSource?: string;
  repoSource?: string | null;
}): string[] {
  const values = [
    options.explicitSource,
    options.envSource,
    'slashbot@latest',
    options.repoSource ?? undefined,
    DEFAULT_BUNDLED_SOURCE,
  ];

  return values.filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  output: CommandOutput
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => output.stdout.write(chunk));
    child.stderr.on('data', (chunk) => output.stderr.write(chunk));
    child.on('error', (error) => rejectRun(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(' ')} exited with code ${code ?? -1}`));
    });
  });
}

async function runLocalCheckoutUpdate(
  packageRoot: string,
  env: NodeJS.ProcessEnv,
  output: CommandOutput
): Promise<void> {
  await runCommand('git', ['-C', packageRoot, 'pull', '--ff-only'], { cwd: packageRoot, env }, output);
  await runCommand('npm', ['install', '--no-fund', '--no-audit'], { cwd: packageRoot, env }, output);
  await runCommand('npm', ['run', 'build'], { cwd: packageRoot, env }, output);
}

async function runBundledUpdate(
  sources: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  output: CommandOutput
): Promise<string> {
  let lastError: string | null = null;
  for (const source of sources) {
    output.stdout.write(`Trying bundled source: ${source}\n`);
    try {
      await runCommand('npm', ['install', '-g', source, '--no-fund', '--no-audit'], { cwd, env }, output);
      return source;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      output.stderr.write(`Source failed (${source}): ${lastError}\n`);
    }
  }

  throw new Error(lastError ?? 'No update source succeeded');
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

async function atomicCopyFile(sourcePath: string, targetPath: string): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsPromises.copyFile(sourcePath, tmpPath);
    try {
      const stat = await fsPromises.stat(targetPath);
      await fsPromises.chmod(tmpPath, stat.mode);
    } catch {
      await fsPromises.chmod(tmpPath, 0o755).catch(() => undefined);
    }
    await fsPromises.rename(tmpPath, targetPath);
  } finally {
    await fsPromises.unlink(tmpPath).catch(() => undefined);
  }
}

async function refreshCopiedLauncher(
  packageRoot: string,
  output: CommandOutput,
  logger?: StructuredLogger
): Promise<void> {
  const sourceCandidate = join(packageRoot, 'dist', 'index.js');
  if (!(await pathExists(sourceCandidate))) return;

  const targetPath = parseEnvString(process.env, 'SLASHBOT_BIN_PATH') ?? process.argv[1];
  if (!targetPath || targetPath.endsWith('.ts')) return;
  if (!(await pathExists(targetPath))) return;
  if (isPathInside(packageRoot, targetPath)) return;

  const targetStat = await fsPromises.lstat(targetPath);
  if (targetStat.isSymbolicLink()) return;

  await atomicCopyFile(sourceCandidate, targetPath);
  const msg = `Updated copied launcher at ${targetPath}`;
  output.stdout.write(`${msg}\n`);
  logger?.info(msg);
}

function shouldSkipRestartForCurrentInvocation(): boolean {
  const topLevelCommand = process.argv[2] ?? 'tui';
  return topLevelCommand === 'update';
}

function restartCurrentProcess(
  cwd: string,
  env: NodeJS.ProcessEnv,
  output: CommandOutput,
  logger?: StructuredLogger
): boolean {
  if (shouldSkipRestartForCurrentInvocation()) {
    output.stdout.write('Update applied. Skipping auto-restart for `slashbot update` invocation.\n');
    return false;
  }
  if ((process.argv[1] ?? '').endsWith('.ts')) {
    output.stdout.write('Update applied. Running from TypeScript entrypoint; restart `npm run dev` manually.\n');
    return false;
  }

  try {
    const restartArgs = process.argv.slice(1);
    const child = spawn(process.execPath, restartArgs, {
      cwd,
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    output.stdout.write('Restarting Slashbot to apply update...\n');
    logger?.info('Restarting Slashbot process after update.');
    setTimeout(() => {
      process.exit(0);
    }, 120);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.stderr.write(`Failed to restart automatically: ${message}\n`);
    logger?.warn('Automatic restart after update failed', { error: message });
    return false;
  }
}

/**
 * Core Ops plugin — essential control-plane commands.
 *
 * Commands:
 *  - `/health`  — Print runtime health summary.
 *  - `/doctor`  — Print plugin diagnostics and failures.
 *  - `/help`    — List all registered commands and tools with usage hints.
 *  - `/clear`   — Clear conversation history.
 *  - `/history` — Show session history guidance.
 *  - `/plugins` — List all loaded plugins.
 *  - `/update`  — Self-update from git checkout or npm bundled install.
 *
 * Hooks:
 *  - `core.auto-update.startup` — Background update check on startup (bundled installs only).
 *
 * Gateway methods:
 *  - `core.health` — Returns kernel health via RPC.
 */
export function createCoreOpsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: 'slashbot.core.ops',
      name: 'Slashbot Core Ops',
      version: '0.1.0',
      main: 'bundled',
      description: 'Health, doctor, help, clear, history, plugins and control plane operations'
    },
    setup: (context) => {
      const paths = context.getService<PathResolver>('kernel.paths')!;
      UPDATE_STATE_PATH = paths.home('update-state.json');

      context.registerCommand({
        id: 'health',
        pluginId: 'slashbot.core.ops',
        description: 'Print runtime health summary',
        execute: async (_args, commandContext) => {
          const getHealth = context.getService<() => unknown>('kernel.health');
          commandContext.stdout.write(`${JSON.stringify(getHealth ? getHealth() : { status: 'unknown' }, null, 2)}\n`);
          return 0;
        }
      });

      context.registerCommand({
        id: 'doctor',
        pluginId: 'slashbot.core.ops',
        description: 'Print plugin diagnostics and failures',
        execute: async (_args, commandContext) => {
          const getDiagnostics = context.getService<() => unknown>('kernel.diagnostics');
          commandContext.stdout.write(
            `${JSON.stringify(getDiagnostics ? getDiagnostics() : { diagnostics: [] }, null, 2)}\n`
          );
          return 0;
        }
      });

      context.registerCommand({
        id: 'help',
        pluginId: 'slashbot.core.ops',
        description: 'List all available commands and tools',
        execute: async (_args, commandContext) => {
          const commandsRegistry = context.getService<CommandRegistry>('kernel.commands.registry');
          const toolsRegistry = context.getService<ToolRegistry>('kernel.tools.registry');
          if (!commandsRegistry || !toolsRegistry) {
            commandContext.stdout.write('Kernel registries not available\n');
            return 1;
          }

          const commands = commandsRegistry.list();
          const tools = toolsRegistry.list();

          commandContext.stdout.write('Commands:\n');
          for (const cmd of commands.sort((a, b) => a.id.localeCompare(b.id))) {
            commandContext.stdout.write(`  /${cmd.id} — ${cmd.description}\n`);
            commandContext.stdout.write(`    Usage: ${commandUsage(cmd)}\n`);
            commandContext.stdout.write(`    When to use: ${commandWhenToUse(cmd)}\n`);
          }

          commandContext.stdout.write('\nTools:\n');
          for (const tool of tools.sort((a, b) => a.id.localeCompare(b.id))) {
            commandContext.stdout.write(`  ${tool.id} — ${tool.title ?? tool.description}\n`);
          }

          return 0;
        }
      });

      context.registerCommand({
        id: 'clear',
        pluginId: 'slashbot.core.ops',
        description: 'Clear the conversation history',
        execute: async (_args, commandContext) => {
          clearHistory();
          const events = context.getService<EventBus>('kernel.events');
          if (events) {
            events.publish('history:clear', {});
          }
          commandContext.stdout.write('History cleared\n');
          return 0;
        }
      });

      context.registerCommand({
        id: 'history',
        pluginId: 'slashbot.core.ops',
        description: 'Show the current session history summary',
        execute: async (_args, commandContext) => {
          commandContext.stdout.write('Session history is managed by the TUI. Use /clear to reset.\n');
          return 0;
        }
      });

      context.registerCommand({
        id: 'plugins',
        pluginId: 'slashbot.core.ops',
        description: 'List, install, or remove external plugins',
        subcommands: ['list', 'install', 'remove'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'list';
          const pluginsDir = paths.workspace('plugins');

          if (sub === 'list') {
            const loadedPlugins = context.getService<() => string[]>('kernel.loadedPlugins');
            const loadedIds = new Set(loadedPlugins ? loadedPlugins() : []);

            // Scan .slashbot/plugins/ for external plugin folders
            const externalManifests: { folder: string; manifest: PluginManifest }[] = [];
            const entries = await fsPromises.readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              try {
                const raw = await fsPromises.readFile(join(pluginsDir, entry.name, 'manifest.json'), 'utf8');
                const manifest = validateManifest(JSON.parse(raw));
                externalManifests.push({ folder: entry.name, manifest });
              } catch {
                // skip invalid folders
              }
            }

            const externalIds = new Set(externalManifests.map((e) => e.manifest.id));

            const removable: string[] = [];
            const builtIn: string[] = [];
            for (const id of loadedIds) {
              (externalIds.has(id) ? removable : builtIn).push(id);
            }

            // Removable (external) plugins first — white
            for (const id of removable) {
              commandContext.stdout.write(`  ${id}  (removable)\n`);
            }

            // Show external plugins that aren't loaded yet — white
            for (const { folder, manifest } of externalManifests) {
              if (!loadedIds.has(manifest.id)) {
                commandContext.stdout.write(`  ${manifest.id}  v${manifest.version}  [${folder}]  (available — restart to activate)\n`);
              }
            }

            // Built-in plugins — muted
            for (const id of builtIn) {
              commandContext.stdout.write(`  \x1b[2m${id}  (built-in)\x1b[0m\n`);
            }

            commandContext.stdout.write(`\nLoaded: ${loadedIds.size}`);
            const pendingCount = externalManifests.filter((e) => !loadedIds.has(e.manifest.id)).length;
            if (pendingCount > 0) {
              commandContext.stdout.write(` | Available: ${pendingCount}`);
            }
            commandContext.stdout.write('\n');
            return 0;
          }

          if (sub === 'install') {
            const url = args[1];
            if (!url) {
              commandContext.stderr.write('Usage: /plugins install <github-url> [name]\n');
              return 1;
            }

            const inferredName = args[2] ?? url.split('/').pop()?.replace(/\.git$/, '') ?? 'unnamed-plugin';
            const targetPath = join(pluginsDir, inferredName);

            try {
              await fsPromises.access(targetPath);
              // Already exists — pull updates
              commandContext.stdout.write(`Updating existing plugin "${inferredName}"...\n`);
              await execFileAsync('git', ['-C', targetPath, 'pull'], { timeout: 30_000 });
            } catch {
              // Clone new
              commandContext.stdout.write(`Installing plugin "${inferredName}" from ${url}...\n`);
              await fsPromises.mkdir(pluginsDir, { recursive: true });
              await execFileAsync('git', ['clone', '--depth', '1', url, targetPath], { timeout: 60_000 });
            }

            // Validate manifest.json
            const manifestPath = join(targetPath, 'manifest.json');
            let manifest: PluginManifest;
            try {
              const raw = await fsPromises.readFile(manifestPath, 'utf8');
              manifest = validateManifest(JSON.parse(raw));
            } catch (err) {
              commandContext.stderr.write(`Warning: manifest.json is missing or invalid in "${inferredName}". The plugin may not load.\n`);
              commandContext.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
              return 1;
            }

            // Check if the entry file exists; if not, attempt to auto-build
            const entryPath = join(targetPath, manifest.main);
            if (!(await pathExists(entryPath))) {
              const sourceEntry = join(targetPath, 'index.ts');
              if (await pathExists(sourceEntry)) {
                commandContext.stdout.write('Plugin needs building...\n');
                try {
                  // Auto-build is handled by the loader on next restart,
                  // but we trigger it eagerly here for immediate feedback.
                  const { autoBuildExternalPlugin } = await import('@slashbot/core/plugins/loader.js');
                  await autoBuildExternalPlugin(targetPath, manifest);
                  commandContext.stdout.write('Built successfully.\n');
                } catch (buildErr) {
                  const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
                  commandContext.stderr.write(`Build failed: ${msg}\n`);
                  commandContext.stderr.write('The plugin will attempt to auto-build on next startup.\n');
                }
              } else {
                commandContext.stderr.write(`Plugin entry "${manifest.main}" not found and no index.ts source detected.\n`);
                return 1;
              }
            }

            commandContext.stdout.write(`Installed "${manifest.name}" (${manifest.id}) v${manifest.version}\n`);
            commandContext.stdout.write('Restart Slashbot to activate the plugin.\n');
            return 0;
          }

          if (sub === 'remove') {
            const name = args[1];
            if (!name) {
              commandContext.stderr.write('Usage: /plugins remove <name>\n');
              return 1;
            }

            const targetPath = resolve(pluginsDir, name);
            if (!isPathInside(pluginsDir, targetPath)) {
              commandContext.stderr.write('Only plugins installed in .slashbot/plugins/ can be removed.\n');
              return 1;
            }

            try {
              await fsPromises.access(targetPath);
            } catch {
              commandContext.stderr.write(`Plugin "${name}" not found in ${pluginsDir}\n`);
              return 1;
            }

            await fsPromises.rm(targetPath, { recursive: true, force: true });
            commandContext.stdout.write(`Removed plugin "${name}". Restart Slashbot to apply.\n`);
            return 0;
          }

          commandContext.stderr.write('Usage: /plugins [list|install|remove]\n');
          return 1;
        }
      });

      context.registerCommand({
        id: 'update',
        pluginId: 'slashbot.core.ops',
        description: 'Update Slashbot for checkout and bundled installs',
        execute: async (_args, commandContext) => {
          const pluginFilePath = fileURLToPath(import.meta.url);
          const packageRoot = await findPackageRoot(dirname(pluginFilePath));
          if (!packageRoot) {
            commandContext.stderr.write('Unable to locate Slashbot package root.\n');
            return 1;
          }

          const isGitCheckout = await pathExists(join(packageRoot, '.git'));
          const explicitSource = parseFlagValue(commandContext.flags, 'source');
          const envSource = parseEnvString(commandContext.env, 'SLASHBOT_UPDATE_SOURCE');
          const repoSource = await detectRepositorySource(packageRoot);

          if (isGitCheckout) {
            commandContext.stdout.write(`Updating local checkout at ${packageRoot}\n`);
            try {
              await runLocalCheckoutUpdate(packageRoot, commandContext.env, commandContext);
              await refreshCopiedLauncher(packageRoot, commandContext);
              commandContext.stdout.write('Update complete.\n');
              restartCurrentProcess(commandContext.cwd, commandContext.env, commandContext);
              return 0;
            } catch (error) {
              commandContext.stderr.write(`Local checkout update failed: ${error instanceof Error ? error.message : String(error)}\n`);
              return 1;
            }
          }

          const sources = buildUpdateSources({ explicitSource, envSource, repoSource });
          try {
            const source = await runBundledUpdate(sources, commandContext.cwd, commandContext.env, commandContext);
            await refreshCopiedLauncher(packageRoot, commandContext);
            commandContext.stdout.write(`Update complete from ${source}.\n`);
            restartCurrentProcess(commandContext.cwd, commandContext.env, commandContext);
            return 0;
          } catch (error) {
            commandContext.stderr.write('Bundled update failed for all sources.\n');
            commandContext.stderr.write(`Last error: ${error instanceof Error ? error.message : String(error)}\n`);
            commandContext.stderr.write('Hint: pass --source <npm-or-github-source> or set SLASHBOT_UPDATE_SOURCE.\n');
            return 1;
          }
        }
      });

      context.registerHook({
        id: 'core.auto-update.startup',
        pluginId: 'slashbot.core.ops',
        domain: 'kernel',
        event: 'startup',
        priority: 90,
        handler: async () => {
          if (shouldSkipRestartForCurrentInvocation()) {
            return;
          }

          const autoUpdateFlag = parseEnvString(process.env, 'SLASHBOT_AUTO_UPDATE');
          if (autoUpdateFlag && ['0', 'false', 'no', 'off'].includes(autoUpdateFlag.toLowerCase())) {
            return;
          }

          const pluginFilePath = fileURLToPath(import.meta.url);
          const packageRoot = await findPackageRoot(dirname(pluginFilePath));
          if (!packageRoot) return;
          if (await pathExists(join(packageRoot, '.git'))) return;

          const currentVersion = await readPackageVersion(packageRoot);
          if (!currentVersion) return;

          const previousState = await loadUpdateState();
          if (!shouldCheckForUpdates(previousState)) return;

          const releasesApi = parseEnvString(process.env, 'SLASHBOT_RELEASES_API') ?? DEFAULT_RELEASES_API;
          const latestVersion = await fetchLatestReleaseVersion(releasesApi);
          await saveUpdateState({
            lastCheckedAt: new Date().toISOString(),
            lastSeenVersion: latestVersion ?? previousState.lastSeenVersion,
          });

          if (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0) {
            return;
          }

          const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
          logger.info('New Slashbot release detected. Running auto-update for bundled install.', {
            currentVersion,
            latestVersion,
          });

          const sources = buildUpdateSources({
            envSource: parseEnvString(process.env, 'SLASHBOT_UPDATE_SOURCE'),
            repoSource: await detectRepositorySource(packageRoot),
          });

          try {
            const source = await runBundledUpdate(sources, packageRoot, process.env, createSilentOutput());
            await refreshCopiedLauncher(packageRoot, createSilentOutput(), logger);
            logger.info('Slashbot auto-update succeeded.', { source, latestVersion });
            restartCurrentProcess(packageRoot, process.env, createSilentOutput(), logger);
          } catch (error) {
            logger.warn('Slashbot auto-update failed.', {
              error: error instanceof Error ? error.message : String(error),
              latestVersion
            });
          }
        }
      });

      context.registerGatewayMethod({
        id: 'core.health',
        pluginId: 'slashbot.core.ops',
        description: 'Returns kernel health object',
        handler: async () => {
          const getHealth = context.getService<() => unknown>('kernel.health');
          const value = getHealth ? getHealth() : { status: 'unknown' };
          return value as JsonValue;
        }
      });
    }
  };
}

export { createCoreOpsPlugin as createPlugin };
