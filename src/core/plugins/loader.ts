/**
 * Plugin loader — instantiates and registers discovered plugins.
 *
 * ## External plugin auto-build
 *
 * External plugins live in `.slashbot/plugins/<name>/` and are described by a
 * single `manifest.json` (no package.json required from the author).
 *
 * When the manifest's `main` entry (e.g. `dist/index.js`) doesn't exist but an
 * `index.ts` source file is present, the loader automatically builds the plugin:
 *
 * 1. Generates a temporary `package.json` from the manifest's `npmDependencies`
 *    and links `@slashbot/plugin-sdk` for type-only imports.
 * 2. Runs `bun install` using the host binary (`process.execPath`).
 * 3. Runs `bun build index.ts` with `--external` for `peerDependencies`
 *    (provided by host, e.g. `zod`) and `npmDependencies` (resolved from the
 *    plugin's own `node_modules/` at runtime).
 * 4. The built output is placed at the path specified by `manifest.main`.
 *
 * ### Manifest fields used by the builder
 *
 * | Field              | Purpose                                           |
 * |--------------------|---------------------------------------------------|
 * | `main`             | Output path for the built bundle (e.g. `dist/index.js`) |
 * | `peerDependencies` | Packages provided by the host — externalized       |
 * | `npmDependencies`  | Packages to install in plugin's `node_modules/`    |
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  PluginDiagnostic,
  PluginManifest,
  PluginRegistrationContext,
  SlashbotPlugin,
  StructuredLogger
} from '../kernel/contracts.js';
import type { DiscoveredPlugin } from './discovery.js';

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: SlashbotPlugin;
}

export type BundledPluginFactory = () => SlashbotPlugin;

async function spawnChecked(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'ignore', stderr: 'pipe' });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd.join(' ')} exited with code ${code}: ${stderr.slice(0, 500)}`);
  }
}

function resolveSlashbotRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (Bun.file(join(dir, 'package.json')).size) return dir;
    dir = dirname(dir);
  }
  return dir;
}

/** Build an external plugin from source using its manifest. Exported for use by install command. */
export async function autoBuildExternalPlugin(pluginRoot: string, manifest: PluginManifest): Promise<void> {
  const bun = process.execPath;
  const sdkPath = join(resolveSlashbotRoot(), 'plugin-sdk');

  // Generate package.json from manifest
  const pkg: Record<string, unknown> = {
    name: manifest.id,
    version: manifest.version,
    private: true,
    type: 'module',
  };
  if (manifest.npmDependencies && Object.keys(manifest.npmDependencies).length > 0) {
    pkg.dependencies = manifest.npmDependencies;
  }
  if (await Bun.file(join(sdkPath, 'index.d.ts')).exists()) {
    pkg.devDependencies = { '@slashbot/plugin-sdk': `file:${sdkPath}` };
  }

  await Bun.write(join(pluginRoot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Install dependencies
  await spawnChecked([bun, 'install'], pluginRoot);

  // Determine source entry and externals
  const sourceEntry = join(pluginRoot, 'index.ts');
  if (!(await Bun.file(sourceEntry).exists())) {
    throw new Error('Source entry index.ts not found');
  }

  const externals: string[] = ['@slashbot/plugin-sdk'];
  if (manifest.peerDependencies) {
    externals.push(...manifest.peerDependencies);
  }
  if (manifest.npmDependencies) {
    externals.push(...Object.keys(manifest.npmDependencies));
  }

  const outdir = join(pluginRoot, dirname(manifest.main));
  const buildArgs = [
    bun, 'build', sourceEntry,
    '--outdir', outdir,
    '--target', 'bun',
    '--format', 'esm',
    ...externals.flatMap(e => ['--external', e]),
  ];

  await spawnChecked(buildArgs, pluginRoot);
}

async function importPluginFromFilesystem(pluginRoot: string, manifest: PluginManifest): Promise<SlashbotPlugin> {
  const entryPath = resolve(pluginRoot, manifest.main);

  // Pre-flight: if entry file is missing, try to auto-build from source
  if (!(await Bun.file(entryPath).exists())) {
    if (await Bun.file(join(pluginRoot, 'index.ts')).exists()) {
      await autoBuildExternalPlugin(pluginRoot, manifest);
      if (!(await Bun.file(entryPath).exists())) {
        throw new Error(`Build succeeded but entry file still missing: ${manifest.main}`);
      }
    } else {
      throw new Error(`Entry file not found: ${manifest.main}`);
    }
  }

  const module = await import(pathToFileURL(entryPath).href);
  const plugin = (module.default ?? module.plugin) as SlashbotPlugin | undefined;

  if (!plugin || typeof plugin.setup !== 'function') {
    throw new Error(`Invalid plugin module at ${entryPath}`);
  }

  return plugin;
}

function isBundledPath(path: string): boolean {
  return path.startsWith('bundled:');
}

function bundledKey(path: string): string {
  return path.replace('bundled:', '');
}

export async function instantiatePlugin(
  plugin: DiscoveredPlugin,
  bundledPlugins: Record<string, BundledPluginFactory>
): Promise<SlashbotPlugin> {
  if (isBundledPath(plugin.pluginPath)) {
    const key = bundledKey(plugin.pluginPath);
    const factory = bundledPlugins[key];
    if (!factory) {
      throw new Error(`Bundled plugin not found: ${key}`);
    }
    return factory();
  }

  return importPluginFromFilesystem(plugin.pluginPath, plugin.manifest);
}

export async function registerPluginSafely(
  plugin: DiscoveredPlugin,
  context: PluginRegistrationContext,
  logger: StructuredLogger,
  bundledPlugins: Record<string, BundledPluginFactory>
): Promise<{ loaded?: LoadedPlugin; diagnostic: PluginDiagnostic }> {
  try {
    const instance = await instantiatePlugin(plugin, bundledPlugins);

    if (instance.manifest.id !== plugin.manifest.id) {
      throw new Error(
        `Manifest id mismatch: discovered ${plugin.manifest.id} but module exported ${instance.manifest.id}`
      );
    }

    await instance.setup(context);
    await instance.activate?.();

    return {
      loaded: {
        manifest: instance.manifest,
        instance
      },
      diagnostic: {
        pluginId: instance.manifest.id,
        status: 'loaded',
        sourcePath: isBundledPath(plugin.pluginPath)
          ? plugin.pluginPath
          : join(plugin.pluginPath, plugin.manifest.main)
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('Plugin registration failed', {
      pluginId: plugin.manifest.id,
      reason
    });

    return {
      diagnostic: {
        pluginId: plugin.manifest.id,
        status: 'failed',
        reason,
        sourcePath: plugin.pluginPath
      }
    };
  }
}
