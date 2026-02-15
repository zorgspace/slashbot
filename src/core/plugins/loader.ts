import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function importPluginFromFilesystem(pluginRoot: string, mainEntry: string): Promise<SlashbotPlugin> {
  const entryPath = resolve(pluginRoot, mainEntry);
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

  return importPluginFromFilesystem(plugin.pluginPath, plugin.manifest.main);
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
