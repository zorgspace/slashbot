/**
 * @module ui/first-run
 *
 * Detects whether the user has ever configured Slashbot by checking
 * for the existence of user-global and workspace-local config files.
 * Used by the CLI router to decide whether to show the setup wizard.
 *
 * @see {@link isConfigurationMissing} -- Configuration detection function
 */
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

/**
 * Checks whether both the user-global and workspace-local config files
 * are absent, indicating a first-run scenario.
 *
 * @param workspaceRoot - The current working directory / workspace root.
 * @param flags - Runtime flags that may override config file paths.
 * @returns `true` if neither user nor workspace config exists.
 */
export async function isConfigurationMissing(workspaceRoot: string, flags: RuntimeFlags): Promise<boolean> {
  const sources = resolveConfigSources(workspaceRoot, flags);
  const [hasUserConfig, hasWorkspaceConfig] = await Promise.all([
    pathExists(sources.userConfigPath),
    pathExists(sources.workspaceConfigPath)
  ]);

  return !hasUserConfig && !hasWorkspaceConfig;
}
