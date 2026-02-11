/**
 * Plugin Loader - Dynamic discovery from settings.json manifests
 *
 * Every plugin/connector can declare a local settings.json:
 * {
 *   "module": "./index.ts",
 *   "exportName": "MyPlugin",
 *   "enabled": true
 * }
 *
 * Optional runtime overrides:
 * - .slashbot/plugins.settings.json
 * - settings.json (root) with a "plugins" object
 */

import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { Plugin, PluginMetadata } from './types';

const SETTINGS_FILENAME = 'settings.json';

type PluginSettingsEntry = {
  module?: string;
  exportName: string;
  enabled?: boolean;
  metadata?: Partial<PluginMetadata>;
};

type PluginRuntimeOverride = {
  enabled?: boolean;
  metadata?: Partial<PluginMetadata>;
};

type PluginRuntimeSettingsFile = {
  plugins?: Record<string, PluginRuntimeOverride>;
};

function getLoaderDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getDiscoveryRoots(): string[] {
  const loaderDir = getLoaderDir();
  return [loaderDir, path.resolve(loaderDir, '../connectors')];
}

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return (await file.json()) as T;
  } catch {
    return null;
  }
}

async function discoverSettingsFiles(): Promise<string[]> {
  const settingsFiles: string[] = [];
  for (const root of getDiscoveryRoots()) {
    let entries: any[] = [];
    try {
      entries = (await readdir(root, { withFileTypes: true, encoding: 'utf8' })) as any[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, String(entry.name), SETTINGS_FILENAME);
      if (await fileExists(candidate)) {
        settingsFiles.push(candidate);
      }
    }
  }
  settingsFiles.sort((a, b) => a.localeCompare(b));
  return settingsFiles;
}

function mergeRuntimeOverrides(
  current: Record<string, PluginRuntimeOverride>,
  next: PluginRuntimeSettingsFile | null,
): Record<string, PluginRuntimeOverride> {
  if (!next?.plugins) return current;
  return { ...current, ...next.plugins };
}

async function loadRuntimeOverrides(): Promise<Record<string, PluginRuntimeOverride>> {
  const projectSettingsPath = path.join(process.cwd(), 'settings.json');
  const slashbotSettingsPath = path.join(process.cwd(), '.slashbot', 'plugins.settings.json');

  let merged: Record<string, PluginRuntimeOverride> = {};
  merged = mergeRuntimeOverrides(
    merged,
    await readJsonFile<PluginRuntimeSettingsFile>(projectSettingsPath),
  );
  merged = mergeRuntimeOverrides(
    merged,
    await readJsonFile<PluginRuntimeSettingsFile>(slashbotSettingsPath),
  );
  return merged;
}

async function resolveExistingModulePath(basePath: string): Promise<string> {
  const attempts = new Set<string>();
  attempts.add(basePath);

  const ext = path.extname(basePath);
  if (ext === '.ts') attempts.add(basePath.slice(0, -3) + '.js');
  if (ext === '.js') attempts.add(basePath.slice(0, -3) + '.ts');
  if (!ext) {
    attempts.add(`${basePath}.ts`);
    attempts.add(`${basePath}.js`);
    attempts.add(path.join(basePath, 'index.ts'));
    attempts.add(path.join(basePath, 'index.js'));
  }

  for (const candidate of attempts) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Plugin module not found: ${basePath}`);
}

async function importModuleFromSettings(
  settingsPath: string,
  moduleRef: string,
): Promise<Record<string, unknown>> {
  const normalized = moduleRef.trim();
  if (!normalized) {
    throw new Error(`Invalid module path in ${settingsPath}`);
  }

  if (normalized.startsWith('.') || normalized.startsWith('/')) {
    const resolved = normalized.startsWith('.')
      ? path.resolve(path.dirname(settingsPath), normalized)
      : normalized;
    const existingPath = await resolveExistingModulePath(resolved);
    const moduleUrl = pathToFileURL(existingPath).href;
    return (await import(moduleUrl)) as Record<string, unknown>;
  }

  return (await import(normalized)) as Record<string, unknown>;
}

function applyMetadataOverride(plugin: Plugin, metadata?: Partial<PluginMetadata>): void {
  if (!metadata) return;
  Object.assign((plugin as any).metadata, metadata);
}

/**
 * Load all built-in plugins using discovered settings manifests.
 */
export async function loadBuiltinPlugins(): Promise<Plugin[]> {
  const settingsFiles = await discoverSettingsFiles();
  const runtimeOverrides = await loadRuntimeOverrides();
  const plugins: Plugin[] = [];

  for (const settingsPath of settingsFiles) {
    const settings = await readJsonFile<PluginSettingsEntry>(settingsPath);
    if (!settings?.exportName) {
      continue;
    }

    if (settings.enabled === false) {
      continue;
    }

    const moduleRef = settings.module?.trim() || './index.ts';
    const moduleNs = await importModuleFromSettings(settingsPath, moduleRef);
    const PluginCtor = moduleNs[settings.exportName];
    if (typeof PluginCtor !== 'function') {
      throw new Error(
        `Invalid export "${settings.exportName}" in ${moduleRef} (from ${settingsPath})`,
      );
    }

    const plugin = new (PluginCtor as new () => Plugin)();
    applyMetadataOverride(plugin, settings.metadata);

    const override = runtimeOverrides[plugin.metadata.id];
    if (override?.enabled === false) {
      continue;
    }
    applyMetadataOverride(plugin, override?.metadata);

    plugins.push(plugin);
  }

  return plugins;
}

/**
 * Load all plugins (built-in + runtime-overridable).
 */
export async function loadAllPlugins(): Promise<Plugin[]> {
  return loadBuiltinPlugins();
}
