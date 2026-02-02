/**
 * CLI Entry Point - Command line argument handling
 */

import { c, errorBlock } from '../ui/colors';
import { createConfigManager } from '../config/config';

export async function handleUpdateCommands(): Promise<boolean> {
  // Handle update commands before anything else
  if (process.argv[2] === 'update-check' || process.argv.includes('--check-update')) {
    const { checkForUpdate } = await import('../updater');
    await checkForUpdate(false, false);
    return true;
  }

  if (process.argv.includes('--update') || process.argv.includes('-u')) {
    const { updateAndRestart } = await import('../updater');
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

export async function handleCliArgs(version: string): Promise<boolean> {
  const args = process.argv.slice(2);

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.violet('Slashbot')} - CLI Assistant powered by Grok

${c.bold('Usage:')}
  slashbot [options]
  slashbot login              Enter API key

${c.bold('Options:')}
  -h, --help      Show this help
  -v, --version   Show version

${c.bold('Commands:')}
  /login          Enter Grok API key
  /logout         Log out
  /task           Manage scheduled tasks
  /notify         Configure notifications
  /help           Show all commands
  /exit           Quit
`);
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
      console.log(c.success('API key saved!'));
      console.log(c.muted('Run slashbot to start.'));
    } else {
      console.log(c.violet('Slashbot Login\n'));
      console.log(c.muted('Usage: slashbot login <api_key>'));
      console.log(c.muted('Or run slashbot and use /login\n'));
      console.log(c.muted('Get your key at https://console.x.ai/'));
    }
    return true;
  }

  // Check for minimum requirements
  if (typeof Bun === 'undefined') {
    console.error(errorBlock('Slashbot requires Bun runtime'));
    console.error(c.muted('Install Bun: curl -fsSL https://bun.sh/install | bash'));
    process.exit(1);
  }

  return false;
}
