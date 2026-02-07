/**
 * OutputInterceptor - Routes stdout/console.log to ChatPanel
 *
 * Monkey-patches process.stdout.write and console.log to capture
 * all output and route it to the TUI ChatPanel instead of raw terminal.
 *
 * With the display service migration, most output now flows directly to TUI
 * via display.*. This interceptor acts as a safety net for:
 * - Stray console.log calls not yet migrated
 * - Third-party library output
 * ANSI stripping is kept since some CLI-fallback code still uses ANSI codes.
 */

type OutputTarget = {
  append: (text: string) => void;
};

// Match ALL ANSI escape sequences (colors, cursor, etc.)
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]/g;

export class OutputInterceptor {
  private target: OutputTarget;
  private originalStdoutWrite: typeof process.stdout.write;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;
  private active = false;

  constructor(target: OutputTarget) {
    this.target = target;
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    const self = this;

    // Patch stdout.write
    process.stdout.write = function (chunk: any, ...args: any[]): boolean {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      self.processOutput(text);
      return true;
    } as any;

    // Patch console.log
    console.log = (...args: any[]) => {
      const text = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
      this.processOutput(text + '\n');
    };

    // Patch console.error
    console.error = (...args: any[]) => {
      const text = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
      this.processOutput(text + '\n');
    };

    // Patch console.warn
    console.warn = (...args: any[]) => {
      const text = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
      this.processOutput(text + '\n');
    };
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    process.stdout.write = this.originalStdoutWrite;
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }

  /**
   * Execute a function with the original stdout (bypassing interception)
   */
  bypass<T>(fn: () => T): T {
    if (!this.active) return fn();
    const wasActive = this.active;
    this.stop();
    try {
      return fn();
    } finally {
      if (wasActive) this.start();
    }
  }

  private processOutput(text: string): void {
    // Strip ANSI escape sequences and carriage returns
    let cleaned = text.replace(ANSI_REGEX, '').replace(/\r/g, '');

    // Strip trailing newlines to prevent double-spacing
    cleaned = cleaned.replace(/\n+$/, '');

    // Skip empty output
    if (!cleaned) return;

    this.target.append(cleaned);
  }
}
