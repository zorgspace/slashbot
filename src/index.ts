#!/usr/bin/env bun
/**
 * Slashbot - Lightweight CLI Assistant powered by Grok
 * A Claude Code-inspired terminal assistant using X.AI's Grok API.
 */

// Must be first: suppress bigint-buffer native binding warning
import './core/utils/suppress-bigint-warning';

import { display } from './core/ui';
import { setupSignalHandlers } from './core/app/signals';
import { handleUpdateCommands, handleVersionFlag } from './core/app/cli';
import { Slashbot } from './core/app/kernel';

// Handle update commands before anything else
if (await handleUpdateCommands()) {
  process.exit(0);
}

// Read version from package.json
import pkg from '../package.json';
const VERSION = pkg.version;

// Handle version flag early
if (handleVersionFlag(VERSION)) {
  process.exit(0);
}

// Current bot reference for signal handlers
let currentBot: Slashbot | null = null;

// Setup signal handlers with bot context (no TUIApp available)
setupSignalHandlers({
  getBot: () => currentBot,
});

// CLI Entry Point
async function main(): Promise<void> {
  const { handleCliArgs, getMessageArg } = await import('./core/app/cli');

  // Handle CLI args (help, version, login)
  if (await handleCliArgs(VERSION)) {
    process.exit(0);
  }

  // Check for -m/--message argument (non-interactive message mode)
  const messageArg = getMessageArg();
  if (messageArg) {
    const bot = new Slashbot();
    bot.setVersion(VERSION);
    await bot.runNonInteractive(messageArg);
    return;
  }

  // Check for non-interactive mode (no TTY, stdin closed, or explicit env var)
  // This happens when running via Exec() from within slashbot itself
  if (process.env.SLASHBOT_NON_INTERACTIVE || !process.stdin.isTTY || process.stdin.destroyed) {
    const bot = new Slashbot();
    bot.setVersion(VERSION);
    await bot.runNonInteractive();
    return;
  }

  // Start Slashbot
  const bot = new Slashbot();
  bot.setVersion(VERSION);
  currentBot = bot;
  await bot.start();
}

// Run
main().catch(error => {
  const msg = error instanceof Error ? error.message : String(error);
  display.errorBlock(msg);
  process.exit(1);
});
