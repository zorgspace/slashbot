/**
 * Signal Handlers - Process signal management
 */

import { c, inputPrompt } from '../ui/colors';

interface SignalContext {
  getBot: () => {
    isThinking: () => boolean;
    abortCurrentOperation: () => void;
    stop: () => void;
  } | null;
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
      console.log(c.violet('\n\nSee you soon!'));
      // Stop the bot (and scheduler) before exiting
      bot?.stop();
      process.exit(0);
    }

    // First Ctrl+C - show warning and redraw prompt
    console.log(c.warning('\nPress Ctrl+C again to exit'));
    process.stdout.write(inputPrompt());
    lastCtrlC = now;
  };

  // Handler for SIGTERM
  const sigtermHandler = () => {
    // In non-interactive mode (spawned as child), exit cleanly on SIGTERM
    if (process.env.SLASHBOT_NON_INTERACTIVE || !process.stdin.isTTY) {
      context.getBot()?.stop();
      process.exit(0);
    }
    console.log(c.warning('\nReceived SIGTERM - use /exit or Ctrl+C twice to quit'));
  };

  // Handler for exit
  const exitHandler = () => {
    context.getBot()?.stop();
  };

  // Handler for uncaught exceptions
  const uncaughtExceptionHandler = (err: Error) => {
    console.log(c.error(`\nError: ${err.message}`));
    // Don't exit - keep running
  };

  // Handler for unhandled rejections
  const unhandledRejectionHandler = (reason: unknown) => {
    console.log(c.error(`\nError: ${reason}`));
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
