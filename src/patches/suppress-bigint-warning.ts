/**
 * Suppress the bigint-buffer native binding warning.
 *
 * This must be imported BEFORE any @solana packages.
 * The warning occurs because Bun-compiled binaries cannot embed native .node addons.
 * The pure JS fallback is fully functional.
 */

const originalWarn = console.warn;

console.warn = (...args: unknown[]) => {
  const message = args[0];
  if (typeof message === 'string' && message.includes('bigint: Failed to load bindings')) {
    return; // Suppress this specific warning
  }
  originalWarn.apply(console, args);
};

export {};
