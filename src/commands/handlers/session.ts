/**
 * Session Command Handlers - login, logout, config
 */

import { c } from '../../ui/colors';
import type { CommandHandler, CommandContext } from '../registry';

export const loginCommand: CommandHandler = {
  name: 'login',
  description: 'Enter Grok API key',
  usage: '/login <api_key>',
  execute: async (args, context) => {
    const apiKey = args.join('');

    if (!apiKey) {
      console.log(`\n${c.violet('Connecting to Grok')}`);
      console.log(c.muted('Get your API key at https://console.x.ai/\n'));
      console.log(`${c.muted('Usage:')} /login <your_api_key>`);
      console.log(`${c.muted('Example:')} /login xai-xxxxxxxxxxxx\n`);
      return true;
    }

    if (!apiKey.startsWith('xai-') && apiKey.length < 20) {
      console.log(c.warning('Invalid key format'));
      console.log(c.muted('X.AI keys start with "xai-"'));
      return true;
    }

    try {
      await context.configManager.saveApiKey(apiKey);
      await context.reinitializeGrok();
      console.log(c.success('Connected to Grok!'));
    } catch (error) {
      console.log(c.error(`Error: ${error}`));
    }

    return true;
  },
};

export const logoutCommand: CommandHandler = {
  name: 'logout',
  description: 'Log out (clear API key)',
  usage: '/logout',
  execute: async (_, context) => {
    await context.configManager.clearApiKey();
    console.log(c.success('Logged out. Use /login to reconnect.'));
    return true;
  },
};

export const configCommand: CommandHandler = {
  name: 'config',
  description: 'Show configuration',
  usage: '/config',
  execute: async (_, context) => {
    const isAuth = context.configManager.isAuthenticated();
    const configDir = context.configManager.getConfigDir();

    console.log(`\n${c.violet('Slashbot Configuration')}\n`);
    console.log(
      `  ${c.muted('Status:')}     ${isAuth ? c.success('Connected') : c.warning('Not connected')}`,
    );
    console.log(`  ${c.muted('Model:')}      grok-4-1-fast-reasoning`);
    console.log(`  ${c.muted('Config:')}     ${configDir}`);

    const tasks = context.scheduler?.listTasks() || [];
    console.log(`\n  ${c.muted('Tasks:')}      ${tasks.length} scheduled`);

    console.log();
    return true;
  },
};

export const sessionHandlers: CommandHandler[] = [loginCommand, logoutCommand, configCommand];
