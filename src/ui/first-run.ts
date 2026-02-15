import { promises as fs } from 'node:fs';
import { resolveConfigSources } from '../core/config/runtime-config.js';
import type { RuntimeFlags } from '../core/kernel/contracts.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function isConfigurationMissing(workspaceRoot: string, flags: RuntimeFlags): Promise<boolean> {
  const sources = resolveConfigSources(workspaceRoot, flags);
  const [hasUserConfig, hasWorkspaceConfig] = await Promise.all([
    pathExists(sources.userConfigPath),
    pathExists(sources.workspaceConfigPath)
  ]);

  return !hasUserConfig && !hasWorkspaceConfig;
}
