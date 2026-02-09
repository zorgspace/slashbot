/**
 * CLI Entry Point - Command line argument handling
 */

import { display } from '../ui';
import { createConfigManager } from '../config/config';

export async function handleUpdateCommands(): Promise<boolean> {
  // Handle update commands before anything else
  if (process.argv[2] === 'update-check' || process.argv.includes('--check-update')) {
    const { checkForUpdate } = await import('./updater');
    await checkForUpdate(false, false);
    return true;
  }

  if (process.argv.includes('--update') || process.argv.includes('-u')) {
    const { updateAndRestart } = await import('./updater');
    await updateAndRestart();
    return true;
  }

  return false;
}

export function handleVersionFlag(version: string): boolean {
  if (process.argv.some(arg => arg === '--version' || arg === '-v')) {
    console.log(`slashbot v${version}`);
    return true;
  }
  return false;
}

/**
 * Parse -m/--message argument and return the message if present
 */
export function getMessageArg(): string | null {
  const args = process.argv.slice(2);
  const msgIndex = args.findIndex(arg => arg === '-m' || arg === '--message');
  if (msgIndex !== -1 && args[msgIndex + 1]) {
    return args[msgIndex + 1];
  }
  // Also support -m"message" or --message="message" format
  for (const arg of args) {
    if (arg.startsWith('-m=')) return arg.slice(3);
    if (arg.startsWith('--message=')) return arg.slice(10);
  }
  return null;
}

export async function handleCliArgs(version: string): Promise<boolean> {
  const args = process.argv.slice(2);

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    display.violet('Slashbot - CLI Assistant powered by Grok');
    display.append('');
    display.boldText('Usage:');
    display.append('  slashbot [options]');
    display.append('  slashbot login              Enter API key');
    display.append('  slashbot -m "message"       Send a message and exit');
    display.append('');
    display.boldText('Options:');
    display.append('  -h, --help           Show this help');
    display.append('  -v, --version        Show version');
    display.append('  -m, --message MSG    Send message non-interactively');
    display.append('');
    display.boldText('Commands:');
    display.append('  /login          Enter Grok API key');
    display.append('  /logout         Log out');
    display.append('  /task           Manage scheduled tasks');
    display.append('  /notify         Configure notifications');
    display.append('  /help           Show all commands');
    display.append('  /exit           Quit');
    return true;
  }

  // Handle --version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`slashbot ${version}`);
    return true;
  }

  // Handle `slashbot login` directly from CLI
  if (args[0] === 'login') {
    const configManager = createConfigManager();
    await configManager.load();

    const apiKey = args[1];
    if (apiKey) {
      await configManager.saveApiKey(apiKey);
      display.successText('API key saved!');
      display.muted('Run slashbot to start.');
    } else {
      display.violet('Slashbot Login');
      display.append('');
      display.muted('Usage: slashbot login <api_key>');
      display.muted('Or run slashbot and use /login');
      display.append('');
      display.muted('Get your key at https://console.x.ai/');
    }
    return true;
  }

  // Check for minimum requirements
  if (typeof Bun === 'undefined') {
    display.errorBlock('Slashbot requires Bun runtime');
    display.muted('Install Bun: curl -fsSL https://bun.sh/install | bash');
    process.exit(1);
  }

  return false;
}
