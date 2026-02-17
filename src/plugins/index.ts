/**
 * @module plugins
 *
 * Bundled plugin loader -- discovers and imports all plugin directories under `src/plugins/`.
 *
 * Scans for subdirectories containing an `index.js` with a `createPlugin()` export,
 * instantiates each plugin to read its manifest, and caches the result.
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
 * Discover and import all bundled plugins from the plugins directory.
 *
 * Scans sibling directories for `index.js` files with a `createPlugin` export,
 * instantiates each to read its manifest, and converts directory names to camelCase keys.
 * Results are cached after the first call.
 *
 * @returns Bundled plugins object containing `factories` map and `discovered` manifest array.
 */
export async function getBundledPlugins(): Promise<BundledPlugins> {
  if (cached) return cached;

  const pluginsDir = dirname(fileURLToPath(import.meta.url));
  const entries = await readdir(pluginsDir, { withFileTypes: true });

  const factories: Record<string, BundledPluginFactory> = {};
  const discovered: DiscoveredPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_DIRS.has(entry.name)) continue;

    const indexPath = join(pluginsDir, entry.name, 'index.js');

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
    } catch {
      // Skip directories without a valid plugin
    }
  }

  cached = { factories, discovered };
  return cached;
}
