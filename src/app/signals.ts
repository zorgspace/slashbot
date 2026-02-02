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

export function setupSignalHandlers(context: SignalContext): void {
  // Prevent accidental exit - require double Ctrl+C
  process.on('SIGINT', () => {
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
    if (now - lastCtrlC < 500) {
      console.log(c.violet('\n\nSee you soon!'));
      // Stop the bot (and scheduler) before exiting
      bot?.stop();
      process.exit(0);
    }

    // First Ctrl+C - show warning and redraw prompt
    console.log(c.warning('\nPress Ctrl+C again to exit'));
    process.stdout.write(inputPrompt());
    lastCtrlC = now;
  });

  // Prevent SIGTERM from killing the app immediately
  process.on('SIGTERM', () => {
    console.log(c.warning('\nReceived SIGTERM - use /exit or Ctrl+C twice to quit'));
  });

  // Clean up on exit
  process.on('exit', () => {
    context.getBot()?.stop();
  });

  // Prevent uncaught exceptions from crashing
  process.on('uncaughtException', err => {
    console.log(c.error(`\nError: ${err.message}`));
    // Don't exit - keep running
  });

  // Prevent unhandled promise rejections from crashing
  process.on('unhandledRejection', reason => {
    console.log(c.error(`\nError: ${reason}`));
    // Don't exit - keep running
  });
}
