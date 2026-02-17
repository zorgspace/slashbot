#!/usr/bin/env node
/**
 * @module index
 *
 * Main entry point for the Slashbot3 CLI application.
 * Bootstraps the runtime by delegating to the CLI router,
 * which determines whether to launch the TUI, run a single prompt,
 * start the gateway, or execute a slash command.
 *
 * @see {@link runCli} -- CLI router that dispatches subcommands
 */
import { runCli } from './ui/cli.js';

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
