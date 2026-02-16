import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { PluginDiagnostic, PluginLoadConfig, PluginManifest } from '../kernel/contracts.js';
import { validateManifest } from './manifest.js';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  pluginPath: string;
  source: 'config' | 'workspace' | 'user-global' | 'bundled';
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[];
  diagnostics: PluginDiagnostic[];
}

async function discoverFromDirectory(basePath: string, source: DiscoveredPlugin['source']): Promise<DiscoveredPlugin[]> {
  const entries = await fs.readdir(basePath, { withFileTypes: true }).catch(() => []);
  const discovered: DiscoveredPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginRoot = join(basePath, entry.name);
    const manifestPath = join(pluginRoot, 'manifest.json');

    try {
      const rawManifest = await fs.readFile(manifestPath, 'utf8');
      const manifest = validateManifest(JSON.parse(rawManifest));
      discovered.push({ manifest, pluginPath: pluginRoot, source });
    } catch {
      // Skip invalid plugins at discovery level. Loader emits detailed diagnostics.
    }
  }

  return discovered;
}

function normalizePaths(config: PluginLoadConfig, workspaceRoot: string): Record<DiscoveredPlugin['source'], string[]> {
  const workspacePath = resolve(workspaceRoot, '.slashbot/extensions');
  const workspacePlugins = resolve(workspaceRoot, '.slashbot/plugins');
  const userPath = resolve(homedir(), '.slashbot/extensions');
  const userPlugins = resolve(homedir(), '.slashbot/plugins');

  return {
    config: config.paths.map((item) => resolve(workspaceRoot, item)),
    workspace: [workspacePath, workspacePlugins],
    'user-global': [userPath, userPlugins],
    bundled: []
  };
}

export async function discoverPlugins(
  config: PluginLoadConfig,
  workspaceRoot: string,
  bundled: DiscoveredPlugin[]
): Promise<DiscoveryResult> {
  const pathMap = normalizePaths(config, workspaceRoot);

  const diagnostics: PluginDiagnostic[] = [];
  const discoveredById = new Map<string, DiscoveredPlugin>();

  for (const source of ['config', 'workspace', 'user-global'] as const) {
    for (const sourcePath of pathMap[source]) {
      const plugins = await discoverFromDirectory(sourcePath, source);
      for (const plugin of plugins) {
        if (!discoveredById.has(plugin.manifest.id)) {
          discoveredById.set(plugin.manifest.id, plugin);
        }
      }
    }
  }

  for (const plugin of bundled) {
    if (!discoveredById.has(plugin.manifest.id)) {
      discoveredById.set(plugin.manifest.id, plugin);
    }
  }

  const knownIds = new Set(discoveredById.keys());
  const listedIds = [
    ...config.allow,
    ...config.deny,
    ...config.entries.map((entry) => entry.id)
  ];

  for (const listedId of listedIds) {
    if (!knownIds.has(listedId)) {
      throw new Error(`Unknown plugin id in allow/deny/entries: ${listedId}`);
    }
  }

  const enabledIds = new Set<string>();
  if (config.allow.length > 0) {
    for (const id of config.allow) {
      enabledIds.add(id);
    }
  } else {
    for (const id of knownIds) {
      enabledIds.add(id);
    }
  }

  for (const denied of config.deny) {
    enabledIds.delete(denied);
  }

  for (const entry of config.entries) {
    if (entry.enabled === false) {
      enabledIds.delete(entry.id);
    }
    if (entry.enabled === true) {
      enabledIds.add(entry.id);
    }
  }

  const plugins = [...enabledIds]
    .map((id) => discoveredById.get(id))
    .filter((item): item is DiscoveredPlugin => Boolean(item));

  for (const [id, plugin] of discoveredById.entries()) {
    if (enabledIds.has(id)) {
      continue;
    }

    diagnostics.push({
      pluginId: id,
      status: 'disabled',
      reason: 'Disabled by allow/deny/entries policy',
      sourcePath: plugin.pluginPath
    });
  }

  return { plugins, diagnostics };
}
