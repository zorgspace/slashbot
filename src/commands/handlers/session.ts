/**
 * Session Command Handlers - login, logout, config, model
 */

import { c } from '../../ui/colors';
import type { CommandHandler, CommandContext } from '../registry';

// Available models (X.AI Grok models)
const AVAILABLE_MODELS = [
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-3-fast',
  'grok-3-mini-fast',
  'grok-code-fast-1',
] as const;

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
    const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';

    console.log(`\n${c.violet('Slashbot Configuration')}\n`);
    console.log(
      `  ${c.muted('Status:')}     ${isAuth ? c.success('Connected') : c.warning('Not connected')}`,
    );
    console.log(`  ${c.muted('Model:')}      ${currentModel}`);
    console.log(`  ${c.muted('Config:')}     ${configDir}`);

    const tasks = context.scheduler?.listTasks() || [];
    console.log(`\n  ${c.muted('Tasks:')}      ${tasks.length} scheduled`);

    console.log();
    return true;
  },
};

export const modelCommand: CommandHandler = {
  name: 'model',
  description: 'Change the AI model',
  usage: '/model [model_name]',
  execute: async (args, context) => {
    if (!context.grokClient) {
      console.log(c.error('Not connected. Use /login first.'));
      return true;
    }

    const modelArg = args.join(' ').trim();

    // No argument - show current model and available options
    if (!modelArg) {
      const currentModel = context.grokClient.getCurrentModel();
      console.log(`\n${c.violet('Model Configuration')}\n`);
      console.log(`  ${c.muted('Current:')} ${c.success(currentModel)}\n`);
      console.log(`  ${c.muted('Available models:')}`);
      for (const model of AVAILABLE_MODELS) {
        const marker = model === currentModel ? c.success('●') : c.muted('○');
        console.log(`    ${marker} ${model}`);
      }
      console.log(`\n  ${c.muted('Usage:')} /model <model_name>`);
      console.log();
      return true;
    }

    // Validate model name
    const isValidModel = AVAILABLE_MODELS.includes(modelArg as any);
    if (!isValidModel) {
      console.log(c.error(`Unknown model: ${modelArg}`));
      console.log(c.muted('Available: ' + AVAILABLE_MODELS.join(', ')));
      return true;
    }

    // Set the model
    context.grokClient.setModel(modelArg);

    // Save to config for persistence
    await context.configManager.saveConfig({ model: modelArg });

    console.log(c.success(`Model changed to ${modelArg}`));
    return true;
  },
};

export const sessionHandlers: CommandHandler[] = [loginCommand, logoutCommand, configCommand, modelCommand];
