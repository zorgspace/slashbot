/**
 * @module plugins
 *
 * Bundled plugin loader -- discovers and imports all plugin directories under `src/plugins/`.
 *
 * Scans for subdirectories containing an `index.js` (or `index.ts` in dev) with a
 * `createPlugin()` export, instantiates each plugin to read its manifest, and caches
 * the result.
 *
 * Skipped directories: `services` (shared utilities, not plugins).
 *
 * @see {@link getBundledPlugins} -- Main entry point returning factories and discovered manifests
 * @see {@link BundledPluginFactory} -- Type alias for a zero-arg plugin factory function
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SlashbotPlugin } from '../core/kernel/contracts.js';
import type { DiscoveredPlugin } from '../core/plugins/discovery.js';

/** Factory function that creates a SlashbotPlugin instance with no arguments. */
export type BundledPluginFactory = () => SlashbotPlugin;

interface BundledPlugins {
  /** Map of camelCase plugin names to their factory functions. */
  factories: Record<string, BundledPluginFactory>;
  /** Array of DiscoveredPlugin entries (manifest + source metadata). */
  discovered: DiscoveredPlugin[];
}

const EXCLUDED_DIRS = new Set(['services']);

let cached: BundledPlugins | null = null;

/**
 * Resolve the plugins directory, handling both dev mode and Bun compiled binaries.
 *
 * In dev mode, `import.meta.url` points to the actual source file on disk.
 * In compiled binaries, it points to `/$bunfs/root/<binary>` which cannot be
 * scanned with `readdir`. In that case, we locate the plugins directory
 * relative to the binary's real location on disk, or fall back to `process.cwd()`.
 */
async function resolvePluginsDir(): Promise<string> {
  // Dev mode: import.meta.url points to the real source file
  const metaDir = dirname(fileURLToPath(import.meta.url));
  try {
    await readdir(metaDir);
    return metaDir;
  } catch {
    // Compiled binary -- $bunfs path is not scannable
  }

  // Try source tree relative to binary location (e.g. dist/../src/plugins)
  const binaryDir = dirname(process.execPath);
  const srcPlugins = join(binaryDir, '..', 'src', 'plugins');
  try {
    await readdir(srcPlugins);
    return srcPlugins;
  } catch {
    // Not next to source tree
  }

  // Last resort: cwd-based (running from project root)
  const cwdPlugins = join(process.cwd(), 'src', 'plugins');
  return cwdPlugins;
}

/**
 * Discover and import all bundled plugins from the plugins directory.
 *
 * Scans sibling directories for `index.js` / `index.ts` files with a `createPlugin` export,
 * instantiates each to read its manifest, and converts directory names to camelCase keys.
 * Results are cached after the first call.
 *
 * @returns Bundled plugins object containing `factories` map and `discovered` manifest array.
 */
export async function getBundledPlugins(): Promise<BundledPlugins> {
  if (cached) return cached;

  const pluginsDir = await resolvePluginsDir();
  const entries = await readdir(pluginsDir, { withFileTypes: true });

  const factories: Record<string, BundledPluginFactory> = {};
  const discovered: DiscoveredPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_DIRS.has(entry.name)) continue;

    // Try .js first (tsc output / ESM), then .ts (dev mode with Bun)
    const jsPath = join(pluginsDir, entry.name, 'index.js');
    const tsPath = join(pluginsDir, entry.name, 'index.ts');

    for (const indexPath of [jsPath, tsPath]) {
      try {
        const mod = await import(pathToFileURL(indexPath).href) as { createPlugin?: BundledPluginFactory };
        if (typeof mod.createPlugin !== 'function') continue;

        const factory = mod.createPlugin;
        const instance = factory();
        const key = entry.name.replace(/-([a-z])/g, (_: string, ch: string) => ch.toUpperCase());

        factories[key] = factory;
        discovered.push({
          manifest: instance.manifest,
          pluginPath: `bundled:${key}`,
          source: 'bundled' as const,
        });
        break; // loaded successfully, no need to try .ts
      } catch {
        // Try next extension, or skip this directory
      }
    }
  }

  cached = { factories, discovered };
  return cached;
}
