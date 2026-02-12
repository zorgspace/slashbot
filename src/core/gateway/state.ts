import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import { getLocalGatewayPidFile, getLocalGatewayStateFile } from '../config/constants';

export interface GatewayDaemonState {
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  version: string;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureGatewayDir(workDir?: string): Promise<void> {
  const pidFile = getLocalGatewayPidFile(workDir);
  await mkdir(path.dirname(pidFile), { recursive: true });
}

export async function readGatewayState(workDir?: string): Promise<GatewayDaemonState | null> {
  try {
    const raw = await readFile(getLocalGatewayStateFile(workDir), 'utf8');
    const parsed = JSON.parse(raw) as GatewayDaemonState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(parsed.pid) || !Number.isFinite(parsed.port)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeGatewayState(state: GatewayDaemonState, workDir?: string): Promise<void> {
  await ensureGatewayDir(workDir);
  await writeFile(getLocalGatewayStateFile(workDir), JSON.stringify(state, null, 2), 'utf8');
}

export async function readGatewayPid(workDir?: string): Promise<number | null> {
  try {
    const raw = await readFile(getLocalGatewayPidFile(workDir), 'utf8');
    const pid = Number(raw.trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return Math.floor(pid);
  } catch {
    return null;
  }
}

export async function writeGatewayPid(pid: number, workDir?: string): Promise<void> {
  await ensureGatewayDir(workDir);
  await writeFile(getLocalGatewayPidFile(workDir), `${Math.floor(pid)}\n`, 'utf8');
}

export async function clearGatewayState(workDir?: string): Promise<void> {
  await Promise.allSettled([
    rm(getLocalGatewayPidFile(workDir), { force: true }),
    rm(getLocalGatewayStateFile(workDir), { force: true }),
  ]);
}

export async function getGatewayDaemonStatus(workDir?: string): Promise<{
  running: boolean;
  pid: number | null;
  state: GatewayDaemonState | null;
}> {
  const pid = await readGatewayPid(workDir);
  const state = await readGatewayState(workDir);
  if (!pid) {
    return {
      running: false,
      pid: null,
      state,
    };
  }
  if (!isProcessRunning(pid)) {
    return {
      running: false,
      pid,
      state,
    };
  }
  return {
    running: true,
    pid,
    state,
  };
}

export async function stopGatewayProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // process already gone
  }
}

export async function waitForGatewayStop(
  pid: number,
  timeoutMs: number = 6_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await sleep(120);
  }
  return !isProcessRunning(pid);
}

export async function waitForGatewayStart(
  timeoutMs: number = 8_000,
  workDir?: string,
): Promise<GatewayDaemonState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getGatewayDaemonStatus(workDir);
    if (status.running && status.state) return status.state;
    await sleep(140);
  }
  return null;
}
