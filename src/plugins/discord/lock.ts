import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import type { DiscordState } from './types.js';

async function lockFileIsReleasable(filePath: string): Promise<boolean> {
  try {
    const rawPid = (await fsPromises.readFile(filePath, 'utf8')).trim();
    const pid = Number(rawPid);
    if (!Number.isFinite(pid)) return true;
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    return true;
  }
}

export async function acquireLock(state: DiscordState): Promise<boolean> {
  const { configDir, lockPath } = state.paths;
  try {
    await fsPromises.mkdir(configDir, { recursive: true });
    await fsPromises.writeFile(lockPath, `${process.pid}`, { flag: 'wx' });
    return true;
  } catch {
    try {
      const rawPid = (await fsPromises.readFile(lockPath, 'utf8')).trim();
      const pid = Number(rawPid);
      if (Number.isFinite(pid) && pid === process.pid) {
        return true;
      }
      try { process.kill(pid, 0); return false; } catch { /* stale lock */ }
      await fsPromises.unlink(lockPath);
      await fsPromises.writeFile(lockPath, `${process.pid}`, { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

export async function releaseLock(state: DiscordState): Promise<void> {
  const { lockPath } = state.paths;
  try {
    if (!(await lockFileIsReleasable(lockPath))) return;
    await fsPromises.unlink(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

export async function flushRuntimeFiles(state: DiscordState): Promise<void> {
  await releaseLock(state);

  const { configTmpPath, locksDirPath } = state.paths;
  try {
    await fsPromises.unlink(configTmpPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  try {
    const entries = await fsPromises.readdir(locksDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.toLowerCase();
      if (!name.includes('discord') || !name.endsWith('.lock')) continue;
      const filePath = join(locksDirPath, entry.name);
      if (!(await lockFileIsReleasable(filePath))) continue;
      try {
        await fsPromises.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw err;
    }
  }
}
