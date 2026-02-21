/**
 * @module ui/tui-utils
 *
 * Shared utilities for the TUI module.
 */

import { appendFileSync } from 'node:fs';

export function debugLog(msg: string): void {
  try { appendFileSync('/tmp/slashbot-debug.log', `[tui ${new Date().toISOString()}] ${msg}\n`); } catch {}
}
