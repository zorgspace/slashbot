/**
 * Session Plugin Commands
 *
 * Commands: login, logout, config, model, provider
 */

import { t, fg, bold } from '@opentui/core';
import { display } from '../../core/ui';
import { theme } from '../../core/ui/theme';
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
      display.appendAssistantStyled(t`
${bold(fg(theme.accent)('Connect to an AI provider'))}
${fg(theme.muted)('Get your API key from:')}
${fg(theme.muted)('  xAI (Grok):    https://console.x.ai/')}
${fg(theme.muted)('  Anthropic:     https://console.anthropic.com/')}
${fg(theme.muted)('  OpenAI:        https://platform.openai.com/')}
${fg(theme.muted)('  Google:        https://aistudio.google.com/')}

${fg(theme.muted)('Usage: /login <your_api_key>')}
${fg(theme.muted)('Example: /login xai-xxxxxxxxxxxx')}
${fg(theme.muted)('Example: /login sk-ant-xxxxxxxxxxxx')}
`);
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

    const allCreds = context.configManager.getAllProviderCredentials();
    const configuredProviders = Object.keys(allCreds);
    const providersList =
      configuredProviders.length > 0
        ? '\n  Providers:  ' +
          configuredProviders
            .map(p => {
              const info = PROVIDERS[p];
              const marker = p === currentProvider ? '[*]' : '[ ]';
              return `${marker} ${info?.name || p}`;
            })
            .join(', ')
        : '';

    const tasks = context.scheduler?.listTasks() || [];

    display.appendAssistantStyled(t`
${bold(fg(theme.accent)('Slashbot Configuration'))}

  Status:     ${isAuth ? 'Connected' : 'Not connected'}
  Provider:   ${providerName}
  Model:      ${currentModel}
  Config:     ${configDir}${providersList}

  Tasks:      ${tasks.length} scheduled
`);
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
      const providerName = PROVIDERS[currentProvider]?.name || currentProvider;
      const modelList = entries
        .map(
          entry => `    ${entry.id === currentModel ? '[*]' : '[ ]'} ${entry.name} (${entry.id})`,
        )
        .join('\n');

      display.appendAssistantStyled(t`
${bold(fg(theme.accent)('Model Configuration'))}

  Provider: ${providerName}
  Current:  ${currentModel}

${fg(theme.muted)('  Available models:')}
${fg(theme.muted)(modelList)}

${fg(theme.muted)('  Usage: /model <model_name>')}
${fg(theme.muted)('  Tip: Use /provider to switch providers')}
`);
      return true;
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
      const allCreds = context.configManager.getAllProviderCredentials();
      const providerLines = Object.entries(PROVIDERS)
        .map(([id, info]) => {
          const isConfigured = !!allCreds[id];
          const isCurrent = id === currentProvider;
          const marker = isCurrent ? '[*]' : isConfigured ? '[+]' : '[ ]';
          const status = isCurrent ? ' (active)' : isConfigured ? ' (configured)' : '';
          return `  ${marker} ${info.name}${status}`;
        })
        .join('\n');

      display.appendAssistantStyled(t`
${bold(fg(theme.accent)('Provider Configuration'))}

${providerLines}

${fg(theme.muted)('  [*] = active  [+] = configured  [ ] = not configured')}
${fg(theme.muted)('  Usage: /provider <name>')}
${fg(theme.muted)('  Example: /provider anthropic')}
`);
      return true;
    }

    // Check if provider exists
    const providerInfo = PROVIDERS[providerArg];
    if (!providerInfo) {
      display.appendAssistantStyled(t`${fg(theme.error)('Unknown provider: ' + providerArg)}
${fg(theme.muted)('Available: ' + Object.keys(PROVIDERS).join(', '))}`);
      return true;
    }

    // Check if provider is configured
    const creds = context.configManager.getProviderCredentials(providerArg);
    if (!creds) {
      display.appendAssistantStyled(t`${fg(theme.error)("Provider '" + providerArg + "' not configured.")}
${fg(theme.muted)('Set ' + providerInfo.envVars[0] + ' environment variable, or /login with the API key.')}`);
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
