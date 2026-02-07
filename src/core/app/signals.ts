/**
 * Signal Handlers - Process signal management
 */

import { display } from '../ui';

interface SignalContext {
  getBot: () => {
    isThinking: () => boolean;
    abortCurrentOperation: () => void;
    stop: () => Promise<void>;
  } | null;
  getTUI?: () => { destroy: () => void } | null;
}

let lastCtrlC = 0;

/**
 * Setup signal handlers with bot context
 * @returns Cleanup function to remove all signal handlers
 */
export function setupSignalHandlers(context: SignalContext): () => void {
  // Handler for SIGINT (Ctrl+C)
  const sigintHandler = () => {
    const now = Date.now();
    const bot = context.getBot();

    // Check if currently thinking/processing
    const wasThinking = bot?.isThinking() ?? false;

    if (wasThinking) {
      // Abort current operation - the normal flow will handle showing the prompt
      bot?.abortCurrentOperation();
      // Just clear the current line (animation), let normal error handling show prompt
      process.stdout.write('\r\x1b[K');
      lastCtrlC = 0; // Reset so next Ctrl+C shows warning instead of exiting
      return;
    }

    // Not thinking - handle double Ctrl+C to exit
    if (now - lastCtrlC < 2000) {
      // Destroy TUI first to restore terminal state
      context.getTUI?.()?.destroy();
      display.violet('\n\nSee you soon!');
      // Await full async shutdown before exiting to avoid
      // in-flight async ops during Bun teardown (causes segfault)
      (async () => {
        await bot?.stop();
        process.exit(0);
      })();
      return;
    }

    // First Ctrl+C - show warning and redraw prompt
    display.warningText('\nPress Ctrl+C again to exit');
    lastCtrlC = now;
  };

  // Handler for SIGTERM
  const sigtermHandler = () => {
    // In non-interactive mode (spawned as child), exit cleanly on SIGTERM
    if (process.env.SLASHBOT_NON_INTERACTIVE || !process.stdin.isTTY) {
      (async () => {
        await context.getBot()?.stop();
        process.exit(0);
      })();
      return;
    }
    display.warningText('\nReceived SIGTERM - use /exit or Ctrl+C twice to quit');
  };

  // Handler for exit - only synchronous cleanup (restoring terminal state)
  // Do NOT call bot.stop() here: it's async and won't complete in exit handlers,
  // and it's already called before process.exit() in all exit paths.
  const exitHandler = () => {
    context.getTUI?.()?.destroy();
  };

  // Handler for uncaught exceptions
  const uncaughtExceptionHandler = (err: Error) => {
    display.errorText(`\nError: ${err.message}`);
    // Don't exit - keep running
  };

  // Handler for unhandled rejections
  const unhandledRejectionHandler = (reason: unknown) => {
    display.errorText(`\nError: ${reason}`);
    // Don't exit - keep running
  };

  // Register all handlers
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);
  process.on('exit', exitHandler);
  process.on('uncaughtException', uncaughtExceptionHandler);
  process.on('unhandledRejection', unhandledRejectionHandler);

  // Return cleanup function
  return () => {
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
    process.off('exit', exitHandler);
    process.off('uncaughtException', uncaughtExceptionHandler);
    process.off('unhandledRejection', unhandledRejectionHandler);
  };
}
