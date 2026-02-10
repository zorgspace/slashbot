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

/**
 * Setup signal handlers with bot context
 * @returns Cleanup function to remove all signal handlers
 */
export function setupSignalHandlers(context: SignalContext): () => void {
  let lastCtrlC = 0;

  // Handler for SIGINT (Ctrl+C)
  // First press: abort current operation (thinking/action)
  // Second press within 2s: graceful shutdown
  const sigintHandler = () => {
    const now = Date.now();
    const bot = context.getBot();

    if (bot?.isThinking()) {
      bot.abortCurrentOperation();
      process.stdout.write('\r\x1b[K');
      lastCtrlC = 0;
      return;
    }

    if (now - lastCtrlC < 2000) {
      context.getTUI?.()?.destroy?.();
      display.violet('\n\nSee you soon!');
      void (async () => {
        await bot?.stop?.();
        process.exit(0);
      })();
      return;
    }

    display.warningText('\nPress Ctrl+C again to exit');
    lastCtrlC = now;
  };

  // Handler for SIGTERM
  const sigtermHandler = () => {
    if (process.env.SLASHBOT_NON_INTERACTIVE || !process.stdin.isTTY) {
      void (async () => {
        await context.getBot()?.stop();
        process.exit(0);
      })();
      return;
    }
    display.warningText('\nReceived SIGTERM - use Ctrl+C twice to quit');
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
