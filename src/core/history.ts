import fs from 'fs';
import os from 'os';
import path from 'path';
import { homedir } from 'os';

function historyDir(): string {
  return path.join(homedir(), '.slashbot');
}

function historyFile(): string {
  return path.join(historyDir(), 'history');
}

function legacyHistoryFile(): string {
  return path.join(process.cwd(), '.slashbot', 'history');
}

function readHistoryLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

export function loadHistory(maxItems = 100): string[] {
  try {
    // Primary location is user-global, so history survives reboots and cwd changes.
    const lines = readHistoryLines(historyFile());
    if (lines.length > 0) {
      return lines.slice(-maxItems);
    }

    // Fallback for legacy workspace-local history files.
    const legacyLines = readHistoryLines(legacyHistoryFile());
    if (legacyLines.length === 0) return [];

    // Migrate legacy history to the primary path on first successful read.
    if (!fs.existsSync(historyDir())) {
      fs.mkdirSync(historyDir(), { recursive: true });
    }
    fs.writeFileSync(historyFile(), `${legacyLines.join(os.EOL)}${os.EOL}`, 'utf8');

    return legacyLines.slice(-maxItems);
  } catch {
    return [];
  }
}

export function appendHistory(entry: string): void {
  try {
    if (!fs.existsSync(historyDir())) {
      fs.mkdirSync(historyDir(), { recursive: true });
    }
    const line = entry.replace(/\n/g, ' ').trim();
    if (!line) return;
    fs.appendFileSync(historyFile(), line + os.EOL, 'utf8');
  } catch {
    // best effort, ignore errors
  }
}

export function clearHistory(): void {
  try {
    fs.rmSync(historyFile(), { force: true });
  } catch {
    // best effort, ignore errors
  }
}
