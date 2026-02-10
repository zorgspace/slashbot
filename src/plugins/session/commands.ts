/**
 * Session Plugin Commands
 *
 * Commands: login, logout, config, model, provider
 */

import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { PROVIDERS, getModelsForProviders } from '../providers/models';

export const loginCommand: CommandHandler = {
  name: 'login',
  description: 'Enter API key (auto-detects provider)',
  usage: '/login <api_key>',
  group: 'Session',
  execute: async (args, context) => {
    const apiKey = args.join('');

    if (!apiKey) {
      display.append('');
      display.violet('Connect to an AI provider');
      display.muted('Get your API key from:');
      display.muted('  xAI (Grok):    https://console.x.ai/');
      display.muted('  Anthropic:     https://console.anthropic.com/');
      display.muted('  OpenAI:        https://platform.openai.com/');
      display.muted('  Google:        https://aistudio.google.com/');
      display.append('');
      display.muted('Usage: /login <your_api_key>');
      display.muted('Example: /login xai-xxxxxxxxxxxx');
      display.muted('Example: /login sk-ant-xxxxxxxxxxxx');
      display.append('');
      return true;
    }

    // Auto-detect provider from API key prefix
    let detectedProvider = 'xai';
    if (apiKey.startsWith('sk-ant-')) {
      detectedProvider = 'anthropic';
    } else if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-ant-')) {
      detectedProvider = 'openai';
    } else if (apiKey.startsWith('xai-')) {
      detectedProvider = 'xai';
    } else if (apiKey.startsWith('AIza')) {
      detectedProvider = 'google';
    }

    try {
      const defaultModel = PROVIDERS[detectedProvider]?.defaultModel;
      await context.configManager.saveApiKey(apiKey);
      await context.configManager.saveProviderCredentials(detectedProvider, { apiKey });
      await context.configManager.saveConfig({
        provider: detectedProvider,
        model: defaultModel,
      });
      await context.reinitializeGrok();
      const providerName = PROVIDERS[detectedProvider]?.name || detectedProvider;
      display.successText(`Connected to ${providerName} (${defaultModel})!`);
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
    const currentModel = context.grokClient?.getCurrentModel() || 'unknown';
    const currentProvider = context.configManager.getProvider();
    const providerName = PROVIDERS[currentProvider]?.name || currentProvider;

    display.append('');
    display.violet('Slashbot Configuration');
    display.append('');
    display.append('  Status:     ' + (isAuth ? 'Connected' : 'Not connected'));
    display.append('  Provider:   ' + providerName);
    display.append('  Model:      ' + currentModel);
    display.append('  Config:     ' + configDir);

    // Show configured providers
    const allCreds = context.configManager.getAllProviderCredentials();
    const configuredProviders = Object.keys(allCreds);
    if (configuredProviders.length > 0) {
      display.append('');
      display.append('  Providers:  ' + configuredProviders.map(p => {
        const info = PROVIDERS[p];
        const marker = p === currentProvider ? '[*]' : '[ ]';
        return `${marker} ${info?.name || p}`;
      }).join(', '));
    }

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
    const currentProvider = context.configManager.getProvider();
    const currentModel = context.grokClient.getCurrentModel();
    const entries = getModelsForProviders([currentProvider]);

    if (!modelArg) {
      if (context.tuiApp) {
        context.tuiApp.setModelSelectModels(currentModel, entries);
        context.tuiApp.showModelSelectModal(
          async (model: string) => {
            if (!context.grokClient) return;
            context.grokClient.setModel(model);
            await context.configManager.saveConfig({ model });
            display.successText('Model changed to ' + model);
          },
          () => { /* cancel */ },
        );
        return true;
      } else {
        display.append('');
        display.violet('Model Configuration');
        display.append('');
        display.append('  Provider: ' + (PROVIDERS[currentProvider]?.name || currentProvider));
        display.append('  Current:  ' + currentModel);
        display.append('');
        display.muted('  Available models:');
        for (const entry of entries) {
          const marker = entry.id === currentModel ? '[*]' : '[ ]';
          display.append('    ' + marker + ' ' + entry.name + '  (' + entry.id + ')');
        }
        display.append('');
        display.muted('  Usage: /model <model_name>');
        display.muted('  Tip: Use /provider to switch providers');
        display.append('');
        return true;
      }
    }

    context.grokClient.setModel(modelArg);
    await context.configManager.saveConfig({ model: modelArg });
    display.successText('Model changed to ' + modelArg);
    return true;
  },
};

export const providerCommand: CommandHandler = {
  name: 'provider',
  description: 'Switch AI provider',
  usage: '/provider [name]',
  group: 'Session',
  execute: async (args, context) => {
    if (!context.grokClient) {
      display.errorText('Not connected. Use /login first.');
      return true;
    }

    const providerArg = args.join(' ').trim().toLowerCase();
    const currentProvider = context.configManager.getProvider();

    if (!providerArg) {
      display.append('');
      display.violet('Provider Configuration');
      display.append('');
      const allCreds = context.configManager.getAllProviderCredentials();
      for (const [id, info] of Object.entries(PROVIDERS)) {
        const isConfigured = !!allCreds[id];
        const isCurrent = id === currentProvider;
        const marker = isCurrent ? '[*]' : isConfigured ? '[+]' : '[ ]';
        const status = isCurrent ? ' (active)' : isConfigured ? ' (configured)' : '';
        display.append(`  ${marker} ${info.name}${status}`);
      }
      display.append('');
      display.muted('  [*] = active  [+] = configured  [ ] = not configured');
      display.muted('  Usage: /provider <name>');
      display.muted('  Example: /provider anthropic');
      display.append('');
      return true;
    }

    // Check if provider exists
    const providerInfo = PROVIDERS[providerArg];
    if (!providerInfo) {
      display.errorText('Unknown provider: ' + providerArg);
      display.muted('Available: ' + Object.keys(PROVIDERS).join(', '));
      return true;
    }

    // Check if provider is configured
    const creds = context.configManager.getProviderCredentials(providerArg);
    if (!creds) {
      display.errorText(`Provider '${providerArg}' not configured.`);
      display.muted(`Set ${providerInfo.envVars[0]} environment variable, or /login with the API key.`);
      return true;
    }

    // Switch provider
    context.grokClient.setProvider(providerArg, creds.apiKey);
    const defaultModel = providerInfo.defaultModel;
    context.grokClient.setModel(defaultModel);
    await context.configManager.saveConfig({ provider: providerArg, model: defaultModel });
    display.successText(`Switched to ${providerInfo.name} (${defaultModel})`);
    return true;
  },
};

export const sessionCommands: CommandHandler[] = [
  loginCommand,
  logoutCommand,
  configCommand,
  modelCommand,
  providerCommand,
];
