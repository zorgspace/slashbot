/**
 * @module plugins/hooks-discovery
 *
 * Hooks Discovery plugin that scans `.slashbot/hooks/` for shell scripts and
 * registers them as kernel hooks. Scripts follow the naming convention
 * `{event}.{name}.sh` and receive the hook event name and JSON payload
 * via environment variables.
 *
 * Convention:
 *  - File: `.slashbot/hooks/{event}.{name}.sh`
 *  - Env vars: `SLASHBOT_HOOK_EVENT`, `SLASHBOT_HOOK_PAYLOAD` (JSON)
 *
 * @see {@link createHooksDiscoveryPlugin} -- Plugin factory function
 */
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SlashbotPlugin, StructuredLogger } from '../../plugin-sdk';

const PLUGIN_ID = 'slashbot.hooks.discovery';
const execFileAsync = promisify(execFile);

interface DiscoveredHook {
  event: string;
  name: string;
  scriptPath: string;
}

function parseHookFilename(filename: string): DiscoveredHook | null {
  // Convention: {event}.{name}.sh
  if (!filename.endsWith('.sh')) return null;
  const withoutExt = filename.slice(0, -3);
  const dotIdx = withoutExt.indexOf('.');
  if (dotIdx === -1) return null;

  const event = withoutExt.slice(0, dotIdx);
  const name = withoutExt.slice(dotIdx + 1);
  if (event.length === 0 || name.length === 0) return null;

  return { event, name, scriptPath: '' };
}

async function discoverHookScripts(hooksDir: string): Promise<DiscoveredHook[]> {
  const hooks: DiscoveredHook[] = [];

  try {
    const entries = await fs.readdir(hooksDir);
    for (const entry of entries) {
      const parsed = parseHookFilename(entry);
      if (parsed) {
        parsed.scriptPath = join(hooksDir, entry);
        hooks.push(parsed);
      }
    }
  } catch {
    // hooks directory doesn't exist yet
  }

  return hooks;
}

/**
 * Create the Hooks Discovery plugin.
 *
 * On kernel startup, scans `.slashbot/hooks/` for shell scripts matching
 * `{event}.{name}.sh` and registers each as a kernel hook. Scripts are
 * executed with `bash` and receive `SLASHBOT_HOOK_EVENT` and
 * `SLASHBOT_HOOK_PAYLOAD` (JSON) environment variables.
 *
 * Hooks:
 *  - `hooks.discovery.startup` -- Scans hooks directory and registers discovered scripts.
 *
 * @returns A SlashbotPlugin instance that discovers and registers filesystem-based hooks.
 */
export function createHooksDiscoveryPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Hooks Discovery',
      version: '0.1.0',
      main: 'bundled',
      description: 'Discover and register shell-exec hooks from .slashbot/hooks/',
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const hooksDir = join(workspaceRoot, '.slashbot', 'hooks');

      context.registerHook({
        id: 'hooks.discovery.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 50,
        handler: async () => {
          // Ensure hooks directory exists
          await fs.mkdir(hooksDir, { recursive: true });

          const hooks = await discoverHookScripts(hooksDir);
          if (hooks.length === 0) return;

          logger.info('Discovered filesystem hooks', { count: hooks.length });

          for (const hook of hooks) {
            context.registerHook({
              id: `hooks.fs.${hook.event}.${hook.name}`,
              pluginId: PLUGIN_ID,
              domain: 'custom',
              event: hook.event,
              priority: 80,
              description: `Filesystem hook: ${basename(hook.scriptPath)}`,
              handler: async (payload) => {
                try {
                  const env = {
                    ...process.env,
                    SLASHBOT_HOOK_EVENT: hook.event,
                    SLASHBOT_HOOK_PAYLOAD: JSON.stringify(payload),
                  };
                  const { stdout, stderr } = await execFileAsync('bash', [hook.scriptPath], {
                    timeout: 30_000,
                    env,
                    cwd: workspaceRoot,
                  });
                  if (stderr) {
                    logger.warn('Hook script stderr', { hook: hook.name, stderr: stderr.slice(0, 500) });
                  }
                  if (stdout.trim().length > 0) {
                    logger.debug('Hook script output', { hook: hook.name, stdout: stdout.slice(0, 500) });
                  }
                } catch (err) {
                  logger.warn('Hook script failed', { hook: hook.name, error: String(err) });
                }
              },
            });
          }
        },
      });
    },
  };
}

/** Alias for {@link createHooksDiscoveryPlugin} conforming to the bundled plugin loader convention. */
export { createHooksDiscoveryPlugin as createPlugin };
