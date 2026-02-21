/**
 * @module plugins/core-ops/config-tools
 *
 * Plugin configuration management (list / install / remove) for the core-ops
 * plugin. Implements the `/plugins` command handler.
 */
import { execFile } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PathResolver, PluginManifest } from '../../plugin-sdk/index.js';
import { validateManifest } from '@slashbot/core/plugins/manifest.js';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

/* ------------------------------------------------------------------ */
/*  /plugins command handler                                           */
/* ------------------------------------------------------------------ */

interface PluginsContext {
  getService<TService>(serviceId: string): TService | undefined;
}

interface PluginsCommandContext {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/**
 * Handler for `/plugins` -- list, install, or remove external plugins.
 */
export function handlePluginsCommand(
  context: PluginsContext,
  paths: PathResolver
): (args: string[], commandContext: PluginsCommandContext) => Promise<number> {
  return async (args, commandContext) => {
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
  };
}
