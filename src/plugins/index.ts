/**
 * Bundled plugin loader — discovers and imports all plugin directories under src/plugins/.
 *
 * Scans for subdirectories containing an `index.js` with a `createPlugin()` export,
 * instantiates each plugin to read its manifest, and caches the result.
 *
 * Skipped directories: `services` (shared utilities, not plugins).
 *
 * Returns:
 *  - `factories` — Map of camelCase plugin names to their factory functions.
 *  - `discovered` — Array of DiscoveredPlugin entries (manifest + source metadata).
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SlashbotPlugin } from '../core/kernel/contracts.js';
import type { DiscoveredPlugin } from '../core/plugins/discovery.js';

export type BundledPluginFactory = () => SlashbotPlugin;

interface BundledPlugins {
  factories: Record<string, BundledPluginFactory>;
  discovered: DiscoveredPlugin[];
}

const EXCLUDED_DIRS = new Set(['services']);

let cached: BundledPlugins | null = null;

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
