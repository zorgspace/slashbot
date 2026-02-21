/**
 * @module plugins/core-ops/commands
 *
 * Command handlers for clear, history, update, and the auto-update startup
 * hook. Also contains all update-related utility functions.
 */
import { spawn } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { StructuredLogger } from '../../plugin-sdk/index.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import { clearHistory } from '@slashbot/core/history.js';
import { pathExists, isPathInside } from './config-tools.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CommandOutput {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface UpdateState {
  lastCheckedAt?: string;
  lastSeenVersion?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_BUNDLED_SOURCE = 'github:zorgspace/slashbot';
const DEFAULT_RELEASES_API = 'https://api.github.com/repos/zorgspace/slashbot/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let UPDATE_STATE_PATH = '';

/** Set the path for the update-state.json file. Called once during setup. */
export function setUpdateStatePath(path: string): void {
  UPDATE_STATE_PATH = path;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function parseFlagValue(flags: Record<string, string | boolean> | undefined, key: string): string | undefined {
  const value = flags?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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

/* ------------------------------------------------------------------ */
/*  Exported command handlers                                          */
/* ------------------------------------------------------------------ */

interface CommandContext {
  getService<TService>(serviceId: string): TService | undefined;
  logger: StructuredLogger;
}

/**
 * Handler for `/clear` -- clear conversation history.
 */
export function handleClearCommand(
  context: CommandContext
): (args: string[], commandContext: { stdout: NodeJS.WritableStream }) => Promise<number> {
  return async (_args, commandContext) => {
    clearHistory();
    const events = context.getService<EventBus>('kernel.events');
    if (events) {
      events.publish('history:clear', {});
    }
    commandContext.stdout.write('History cleared\n');
    return 0;
  };
}

/**
 * Handler for `/history` -- show session history guidance.
 */
export function handleHistoryCommand(): (
  args: string[],
  commandContext: { stdout: NodeJS.WritableStream }
) => Promise<number> {
  return async (_args, commandContext) => {
    commandContext.stdout.write('Session history is managed by the TUI. Use /clear to reset.\n');
    return 0;
  };
}

/**
 * Handler for `/update` -- self-update from git checkout or npm bundled install.
 */
export function handleUpdateCommand(): (
  args: string[],
  commandContext: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd: string;
    env: NodeJS.ProcessEnv;
    flags?: Record<string, string | boolean>;
  }
) => Promise<number> {
  return async (_args, commandContext) => {
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
  };
}

/**
 * Auto-update startup hook handler.
 */
export function handleAutoUpdateStartup(
  context: CommandContext
): () => Promise<void> {
  return async () => {
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
  };
}
