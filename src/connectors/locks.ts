/**
 * Connector Lock Manager
 * Ensures only one instance of Telegram/Discord connector runs at a time
 *
 * Uses PID-based lock files stored in ~/.slashbot/locks/
 */

import { HOME_LOCKS_DIR } from '../constants';
import * as path from 'path';

export type ConnectorType = 'telegram' | 'discord';

interface LockInfo {
  pid: number;
  startedAt: string;
  workDir: string;
}

/**
 * Get the lock file path for a connector
 */
function getLockFile(connector: ConnectorType): string {
  return path.join(HOME_LOCKS_DIR, `${connector}.lock`);
}

/**
 * Check if a process is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to acquire a lock for a connector
 * Returns true if lock acquired, false if another instance is running
 */
export async function acquireLock(connector: ConnectorType): Promise<{ acquired: boolean; existingPid?: number; existingWorkDir?: string }> {
  const { mkdir, readFile, writeFile, unlink } = await import('fs/promises');
  const lockFile = getLockFile(connector);

  // Ensure locks directory exists
  await mkdir(HOME_LOCKS_DIR, { recursive: true });

  // Check if lock file exists
  try {
    const content = await readFile(lockFile, 'utf-8');
    const lockInfo: LockInfo = JSON.parse(content);

    // Check if the process is still running
    if (isProcessRunning(lockInfo.pid)) {
      // Another instance is running
      return {
        acquired: false,
        existingPid: lockInfo.pid,
        existingWorkDir: lockInfo.workDir,
      };
    }

    // Process is dead, remove stale lock
    await unlink(lockFile);
  } catch {
    // Lock file doesn't exist or is invalid
  }

  // Create new lock file
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    workDir: process.cwd(),
  };

  await writeFile(lockFile, JSON.stringify(lockInfo, null, 2));

  // Register cleanup on exit
  const cleanup = async () => {
    try {
      const content = await readFile(lockFile, 'utf-8');
      const info: LockInfo = JSON.parse(content);
      // Only remove if it's our lock
      if (info.pid === process.pid) {
        await unlink(lockFile);
      }
    } catch {
      // Ignore errors during cleanup
    }
  };

  process.on('exit', () => {
    // Synchronous cleanup on exit
    try {
      const fs = require('fs');
      const content = fs.readFileSync(lockFile, 'utf-8');
      const info = JSON.parse(content);
      if (info.pid === process.pid) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Ignore
    }
  });

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { acquired: true };
}

/**
 * Release a lock for a connector
 */
export async function releaseLock(connector: ConnectorType): Promise<void> {
  const { readFile, unlink } = await import('fs/promises');
  const lockFile = getLockFile(connector);

  try {
    const content = await readFile(lockFile, 'utf-8');
    const lockInfo: LockInfo = JSON.parse(content);

    // Only remove if it's our lock
    if (lockInfo.pid === process.pid) {
      await unlink(lockFile);
    }
  } catch {
    // Lock file doesn't exist or we don't own it
  }
}

/**
 * Check if a connector is locked by another instance
 */
export async function isLocked(connector: ConnectorType): Promise<{ locked: boolean; pid?: number; workDir?: string }> {
  const { readFile } = await import('fs/promises');
  const lockFile = getLockFile(connector);

  try {
    const content = await readFile(lockFile, 'utf-8');
    const lockInfo: LockInfo = JSON.parse(content);

    if (isProcessRunning(lockInfo.pid)) {
      return {
        locked: true,
        pid: lockInfo.pid,
        workDir: lockInfo.workDir,
      };
    }
  } catch {
    // Lock file doesn't exist
  }

  return { locked: false };
}
