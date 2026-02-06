/**
 * Session Plugin Commands
 *
 * Commands: login, logout, config, model
 */

import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';

// Available models (X.AI Grok models)
const AVAILABLE_MODELS = [
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1',
] as const;

export const loginCommand: CommandHandler = {
  name: 'login',
  description: 'Enter Grok API key',
  usage: '/login <api_key>',
  group: 'Session',
  execute: async (args, context) => {
    const apiKey = args.join('');

    if (!apiKey) {
      display.append('');
      display.violet('Connecting to Grok');
      display.muted('Get your API key at https://console.x.ai/');
      display.append('');
      display.muted('Usage: /login <your_api_key>');
      display.muted('Example: /login xai-xxxxxxxxxxxx');
      display.append('');
      return true;
    }

    if (!apiKey.startsWith('xai-') && apiKey.length < 20) {
      display.warningText('Invalid key format');
      display.muted('X.AI keys start with "xai-"');
      return true;
    }

    try {
      await context.configManager.saveApiKey(apiKey);
      await context.reinitializeGrok();
      display.successText('Connected to Grok!');
    } catch (error) {
      display.errorText('Error: ' + error);
    }

    return true;
  },
};

export const logoutCommand: CommandHandler = {
  name: 'logout',
  description: 'Log out (clear API key)',
  usage: '/logout',
  group: 'Session',
  execute: async (_, context) => {
    await context.configManager.clearApiKey();
    display.successText('Logged out. Use /login to reconnect.');
    return true;
  },
};

export const configCommand: CommandHandler = {
  name: 'config',
  description: 'Show configuration',
  usage: '/config',
  group: 'Session',
  execute: async (_, context) => {
    const isAuth = context.configManager.isAuthenticated();
    const configDir = context.configManager.getConfigDir();
    const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';

    display.append('');
    display.violet('Slashbot Configuration');
    display.append('');
    display.append('  Status:     ' + (isAuth ? 'Connected' : 'Not connected'));
    display.append('  Model:      ' + currentModel);
    display.append('  Config:     ' + configDir);

    const tasks = context.scheduler?.listTasks() || [];
    display.append('');
    display.append('  Tasks:      ' + tasks.length + ' scheduled');

    display.append('');
    return true;
  },
};

export const modelCommand: CommandHandler = {
  name: 'model',
  description: 'Change the AI model',
  usage: '/model [model_name]',
  group: 'Session',
  execute: async (args, context) => {
    if (!context.grokClient) {
      display.errorText('Not connected. Use /login first.');
      return true;
    }

    const modelArg = args.join(' ').trim();

    if (!modelArg) {
      const currentModel = context.grokClient.getCurrentModel();
      display.append('');
      display.violet('Model Configuration');
      display.append('');
      display.append('  Current: ' + currentModel);
      display.append('');
      display.muted('  Available models:');
      for (const model of AVAILABLE_MODELS) {
        const marker = model === currentModel ? '[*]' : '[ ]';
        display.append('    ' + marker + ' ' + model);
      }
      display.append('');
      display.muted('  Usage: /model <model_name>');
      display.append('');
      return true;
    }

    const isValidModel = AVAILABLE_MODELS.includes(modelArg as any);
    if (!isValidModel) {
      display.errorText('Unknown model: ' + modelArg);
      display.muted('Available: ' + AVAILABLE_MODELS.join(', '));
      return true;
    }

    context.grokClient.setModel(modelArg);
    await context.configManager.saveConfig({ model: modelArg });
    display.successText('Model changed to ' + modelArg);
    return true;
  },
};

export const sessionCommands: CommandHandler[] = [
  loginCommand,
  logoutCommand,
  configCommand,
  modelCommand,
];
