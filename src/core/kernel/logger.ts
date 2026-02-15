import type { JsonValue, StructuredLogger } from './contracts.js';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

export interface LogEntry {
  ts: string;
  level: Level;
  message: string;
  fields?: Record<string, JsonValue>;
}

export interface KernelLogger extends StructuredLogger {
  subscribe: (listener: (entry: LogEntry) => void) => () => void;
  setTerminalOutputEnabled: (enabled: boolean) => void;
}

function shouldLog(current: Level, incoming: Level): boolean {
  return LEVELS.indexOf(incoming) >= LEVELS.indexOf(current);
}

export function createLogger(level: Level = 'info'): KernelLogger {
  const listeners = new Set<(entry: LogEntry) => void>();
  let terminalOutputEnabled = true;

  const write = (incoming: Level, message: string, fields?: Record<string, JsonValue>): void => {
    if (!shouldLog(level, incoming)) {
      return;
    }

    const payload: LogEntry = {
      ts: new Date().toISOString(),
      level: incoming,
      message,
      ...(fields ? { fields } : {})
    };

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Logging listeners should never break runtime execution.
      }
    }

    if (!terminalOutputEnabled) {
      return;
    }

    const line = JSON.stringify(payload);
    // Keep machine logs off stdout so Ink TUI redraws stay stable.
    process.stderr.write(`${line}\n`);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTerminalOutputEnabled: (enabled) => {
      terminalOutputEnabled = enabled;
    }
  };
}
