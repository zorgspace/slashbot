import * as os from 'os';
import * as path from 'path';
import { c, colors } from './ui/colors';
import { promises as fs } from 'fs';
// import type { Notifier } from './notify/notifier';

const REPO = process.env.SLASHBOT_REPO || 'OWNER/slashbot'; // TODO: set real repo, e.g. 'yourorg/slashbot'
const USER_AGENT = 'Slashbot-Updater/1.0';

export async function getCurrentVersion(): Promise<string> {
  try {
    // Try to read package.json relative to binary location
    const binDir = path.dirname(process.execPath || process.argv[1]);
    const pkgPath = path.join(binDir, '..', 'package.json');
    const pkgText = await Bun.file(pkgPath).text();
    const pkg = JSON.parse(pkgText);
    return pkg.version as string;
  } catch {
    return '1.0.5'; // fallback
  }
}

function versionGt(v1: string, v2: string): boolean {
  // Simple semver compare: major.minor.patch
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return true;
    if (p1[i] < p2[i]) return false;
  }
  return false;
}

export async function checkForUpdate(notifier?: any): Promise<boolean> {
  try {
    console.log(c.info('Checking for updates...'));
    const currentVersion = await getCurrentVersion();
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const release: any = await res.json();
    let latestVersion = release.tag_name.replace(/^v/i, '');
    if (!versionGt(currentVersion, latestVersion)) {
      console.log(c.success(`✓ Up to date: v${currentVersion}`));
      return false;
    }

    const plat = os.platform() === 'darwin' ? 'macos' : os.platform();
    const arch = os.arch() === 'x64' ? 'amd64' : os.arch();
    const assetName = `slashbot-${plat}-${arch}`;
    const asset = release.assets.find((a: any) => a.name === assetName);
    if (!asset) {
      console.log(c.warning(`No matching binary for ${plat}-${arch}`));
      return false;
    }

    const binPath = process.execPath || process.argv[1];
    const tempPath = binPath + '.new';
    console.log(c.violet(`Downloading update v${latestVersion}`));

    const dlRes = await fetch(asset.browser_download_url, { headers: { 'User-Agent': USER_AGENT } });
    const buffer = await dlRes.arrayBuffer();
    await Bun.write(tempPath, new Uint8Array(buffer));
    await fs.chmod(tempPath, 0o755);

    // Spawn self-update: new binary replaces old and restarts
    console.log(c.warning(`Update ready at ${tempPath}`));
    console.log(c.info(`Install: mv "${tempPath}" "$(which slashbot || echo ./dist/slashbot)" && chmod +x "$(which slashbot || echo ./dist/slashbot)"`));
    process.exit(0);
    return true;
  } catch (err: any) {
    const msg = `Update check failed: ${err.message}`;
    console.error(c.error(`✗ ${msg}`));
    notifier?.send('error', msg);
    return false;
  }
}

// Handle --self-update oldPath
