/**
 * Auto-updater for Slashbot
 * Downloads and installs updates from GitHub releases (zorspace/slashbot)
 */

import * as os from 'os';
import * as path from 'path';
import { display } from '../ui';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

const REPO = 'zorgspace/slashbot';
const USER_AGENT = 'Slashbot-Updater/1.0';
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
  published_at: string;
}

/**
 * Get current version from package.json
 */
export async function getCurrentVersion(): Promise<string> {
  try {
    // Import from package.json directly (bundled at compile time)
    const pkg = await import('../../../package.json');
    return pkg.version;
  } catch {
    try {
      // Fallback: read from file system
      const binDir = path.dirname(process.execPath || process.argv[1]);
      const pkgPath = path.join(binDir, '..', 'package.json');
      const pkgText = await Bun.file(pkgPath).text();
      const pkg = JSON.parse(pkgText);
      return pkg.version as string;
    } catch {
      return '0.0.0';
    }
  }
}

/**
 * Compare semver versions: returns true if v1 > v2
 */
function versionGreaterThan(v1: string, v2: string): boolean {
  const p1 = v1.replace(/^v/, '').split('.').map(Number);
  const p2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return true;
    if (n1 < n2) return false;
  }
  return false;
}

/**
 * Get the latest release info from GitHub
 */
export async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return null; // No releases yet
      }
      throw new Error(`GitHub API error: ${res.status}`);
    }

    return (await res.json()) as GitHubRelease;
  } catch (err) {
    return null;
  }
}

/**
 * Get the appropriate asset name for current platform
 */
function getAssetName(): string {
  const platform = os.platform();
  const arch = os.arch();

  // Map platform names
  let platName: string;
  if (platform === 'darwin') {
    platName = 'macos';
  } else if (platform === 'win32') {
    platName = 'windows';
  } else {
    platName = 'linux';
  }

  // Map architecture names
  let archName: string;
  if (arch === 'x64') {
    archName = 'x64';
  } else if (arch === 'arm64') {
    archName = 'arm64';
  } else {
    archName = arch;
  }

  return `slashbot-${platName}-${archName}`;
}

/**
 * Check if an update is available
 */
export async function checkUpdateAvailable(): Promise<{
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  release?: GitHubRelease;
}> {
  const currentVersion = await getCurrentVersion();
  const release = await getLatestRelease();

  if (!release) {
    return { available: false, currentVersion };
  }

  const latestVersion = release.tag_name.replace(/^v/, '');

  if (versionGreaterThan(latestVersion, currentVersion)) {
    return {
      available: true,
      currentVersion,
      latestVersion,
      release,
    };
  }

  return { available: false, currentVersion, latestVersion };
}

/**
 * Download and install the update
 */
export async function downloadAndInstall(release: GitHubRelease): Promise<boolean> {
  const assetName = getAssetName();
  const asset = release.assets.find(a => a.name === assetName || a.name === `${assetName}.exe`);

  if (!asset) {
    display.warningText(`No binary available for ${assetName}`);
    display.muted(`Available assets: ${release.assets.map(a => a.name).join(', ')}`);
    return false;
  }

  const binPath = process.execPath || process.argv[1];
  const binDir = path.dirname(binPath);
  const tempPath = path.join(binDir, '.slashbot-update');
  const backupPath = path.join(binDir, '.slashbot-backup');

  try {
    // Download the new binary
    display.violet(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);

    const dlRes = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });

    if (!dlRes.ok) {
      throw new Error(`Download failed: HTTP ${dlRes.status}`);
    }

    const buffer = await dlRes.arrayBuffer();
    await Bun.write(tempPath, new Uint8Array(buffer));
    await fs.chmod(tempPath, 0o755);

    display.successText('Download complete');

    // Backup current binary
    try {
      await fs.copyFile(binPath, backupPath);
    } catch {
      // Ignore backup errors
    }

    // Replace binary (atomic on Unix)
    await fs.rename(tempPath, binPath);
    await fs.chmod(binPath, 0o755);

    display.successText(`Updated to v${release.tag_name.replace(/^v/, '')}`);

    // Clean up backup after successful update
    try {
      await fs.unlink(backupPath);
    } catch {
      // Ignore cleanup errors
    }

    return true;
  } catch (err: any) {
    display.errorText(`Update failed: ${err.message}`);

    // Try to restore from backup
    try {
      if (await Bun.file(backupPath).exists()) {
        await fs.rename(backupPath, binPath);
        display.muted('Restored previous version');
      }
    } catch {
      // Restore failed
    }

    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore
    }

    return false;
  }
}

/**
 * Check for updates and optionally install them
 * @param autoInstall - If true, automatically install updates
 * @param silent - If true, don't print messages when up-to-date
 */
export async function checkForUpdate(autoInstall = false, silent = false): Promise<boolean> {
  try {
    if (!silent) {
      display.muted('Checking for updates...');
    }

    const { available, currentVersion, latestVersion, release } = await checkUpdateAvailable();

    if (!available) {
      if (!silent) {
        display.successText(`Up to date (v${currentVersion})`);
      }
      return false;
    }

    display.info(`Update available: v${currentVersion} → v${latestVersion}`);

    if (release?.body) {
      // Show release notes (first 3 lines)
      const notes = release.body.split('\n').slice(0, 3).join('\n');
      display.muted(notes);
    }

    if (autoInstall && release) {
      return await downloadAndInstall(release);
    } else {
      display.muted(`Run 'slashbot --update' to install the update`);
      return false;
    }
  } catch (err: any) {
    if (!silent) {
      display.errorText(`Update check failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Perform the update and restart slashbot
 */
export async function updateAndRestart(): Promise<void> {
  const { available, release } = await checkUpdateAvailable();

  if (!available || !release) {
    display.successText('Already running the latest version');
    return;
  }

  const success = await downloadAndInstall(release);

  if (success) {
    display.violet('Restarting...');

    // Restart slashbot with same arguments
    const args = process.argv.slice(2).filter(a => a !== '--update');
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'inherit',
    });
    child.unref();
    process.exit(0);
  }
}

/**
 * Check if we should check for updates (based on last check time)
 */
export async function shouldCheckForUpdates(): Promise<boolean> {
  const HOME_SLASHBOT_DIR = path.join(os.homedir(), '.slashbot');
  const lastCheckFile = path.join(HOME_SLASHBOT_DIR, '.last-update-check');

  try {
    const lastCheck = await Bun.file(lastCheckFile).text();
    const lastCheckTime = parseInt(lastCheck, 10);
    const now = Date.now();

    if (now - lastCheckTime < UPDATE_CHECK_INTERVAL) {
      return false;
    }
  } catch {
    // File doesn't exist, should check
  }

  // Update last check time
  try {
    await fs.mkdir(HOME_SLASHBOT_DIR, { recursive: true });
    await Bun.write(lastCheckFile, String(Date.now()));
  } catch {
    // Ignore
  }

  return true;
}

/**
 * Background update check at startup (non-blocking)
 */
export async function startupUpdateCheck(): Promise<void> {
  // Only check periodically
  const shouldCheck = await shouldCheckForUpdates();
  if (!shouldCheck) return;

  // Run check in background (don't block startup)
  checkUpdateAvailable()
    .then(({ available, latestVersion }) => {
      if (available) {
        display.info(
          `\nUpdate available: v${latestVersion} - run 'slashbot --update' to install\n`,
        );
      }
    })
    .catch(() => {
      // Silently ignore errors during background check
    });
}
