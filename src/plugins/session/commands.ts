/**
 * Session Plugin Commands
 *
 * Commands: login, logout, config, model, provider
 */

import { t, fg, bold } from '@opentui/core';
import { createInterface } from 'readline';
import { display } from '../../core/ui';
import { theme } from '../../core/ui/theme';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { PROVIDERS, getModelsForProviders, inferProviderFromKey } from '../providers/models';

const SUPPORTED_PROVIDER_IDS = Object.keys(PROVIDERS);

function isSupportedProvider(providerId: string): boolean {
  return SUPPORTED_PROVIDER_IDS.includes(providerId);
}

function normalizeProviderChoice(input: string, fallbackProvider: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return fallbackProvider;
  }

  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= SUPPORTED_PROVIDER_IDS.length) {
    return SUPPORTED_PROVIDER_IDS[asNumber - 1];
  }

  if (isSupportedProvider(trimmed)) {
    return trimmed;
  }

  return null;
}

function resolveDefaultModel(context: CommandContext, providerId: string): string {
  const providerDefault = PROVIDERS[providerId]?.defaultModel || 'grok-code-fast-1';
  const currentProvider = context.configManager.getProvider();
  if (currentProvider !== providerId) {
    return providerDefault;
  }

  const currentModel = context.grokClient?.getCurrentModel();
  if (currentModel) {
    return currentModel;
  }

  const configuredModel = context.configManager.getConfig().model;
  return configuredModel || providerDefault;
}

function resolveModelChoice(input: string, providerId: string, fallbackModel: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return fallbackModel;
  }

  const models = getModelsForProviders([providerId]);
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= models.length) {
    return models[asNumber - 1].id;
  }

  const lower = trimmed.toLowerCase();
  const byId = models.find(m => m.id.toLowerCase() === lower);
  if (byId) {
    return byId.id;
  }
  const byName = models.find(m => m.name.toLowerCase() === lower);
  if (byName) {
    return byName.id;
  }

  return trimmed;
}

async function promptText(context: CommandContext, label: string, initialValue?: string): Promise<string> {
  if (context.tuiApp) {
    return context.tuiApp.promptInput(label, {
      initialValue: initialValue ?? '',
    });
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return '';
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return await new Promise(resolve => {
    rl.question(`${label}: `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptSecret(context: CommandContext, label: string): Promise<string> {
  if (context.tuiApp) {
    return context.tuiApp.promptInput(label, { masked: true });
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return '';
  }

  process.stdout.write(`${label}: `);
  let value = '';
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise(resolve => {
    const onKeyPress = (key: Buffer) => {
      const char = key.toString();
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
        return;
      }
      if (char === '\x7f' || char === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
        }
        return;
      }
      if (char.length === 1 && char >= ' ') {
        value += char;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeyPress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    process.stdin.on('data', onKeyPress);
  });
}

function renderProviderWizardBlock(currentProvider: string, configuredProviders: string[]): string {
  const lines = [
    'Login Wizard',
    '',
    'Step 1/3 - Choose provider:',
  ];
  for (let i = 0; i < SUPPORTED_PROVIDER_IDS.length; i += 1) {
    const id = SUPPORTED_PROVIDER_IDS[i];
    const info = PROVIDERS[id];
    const marker = id === currentProvider ? '[*]' : configuredProviders.includes(id) ? '[+]' : '[ ]';
    lines.push(`  ${i + 1}. ${marker} ${id} (${info.name})`);
  }
  lines.push('');
  lines.push('  [*] active  [+] configured  [ ] not configured');
  lines.push('  Tip: type provider id (xai/openai/anthropic/google) or number');
  return lines.join('\n');
}

function renderModelWizardBlock(providerId: string, defaultModel: string): string {
  const providerInfo = PROVIDERS[providerId];
  const models = getModelsForProviders([providerId]);
  const lines = [
    `Step 3/3 - Choose model for ${providerInfo?.name || providerId}:`,
  ];
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    const marker = model.id === defaultModel ? '[*]' : '[ ]';
    lines.push(`  ${i + 1}. ${marker} ${model.name} (${model.id})`);
  }
  lines.push('');
  lines.push('  Tip: type model number or model id');
  return lines.join('\n');
}

function renderLoginHelp(): string {
  return [
    'Connect to an AI provider',
    '',
    'Interactive wizard:',
    '  /login',
    '  /login <provider>',
    '',
    'Direct mode:',
    '  /login <api_key>',
    '  /login <provider> <api_key> [model]',
    '  /login <api_key> <provider> [model]',
    '',
    'Providers:',
    '  - xai',
    '  - anthropic',
    '  - openai',
    '  - google',
    '',
    'Get API keys from:',
    '  xAI:       https://console.x.ai/',
    '  Anthropic: https://console.anthropic.com/',
    '  OpenAI:    https://platform.openai.com/',
    '  Google:    https://aistudio.google.com/',
  ].join('\n');
}

async function applyLoginSelection(
  context: CommandContext,
  providerId: string,
  apiKey: string,
  modelId: string,
): Promise<boolean> {
  const providerInfo = PROVIDERS[providerId];
  if (!providerInfo) {
    display.errorText(`Unknown provider: ${providerId}`);
    return true;
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    display.errorText('API key is required.');
    return true;
  }

  const models = getModelsForProviders([providerId]);
  if (!models.some(m => m.id === modelId)) {
    display.warningText(
      `Model "${modelId}" is not in the local catalog for ${providerInfo.name}. Continuing anyway.`,
    );
  }

  try {
    await context.configManager.saveProviderCredentials(providerId, { apiKey: trimmedKey });
    await context.configManager.saveApiKey(trimmedKey);
    await context.configManager.saveConfig({
      provider: providerId,
      model: modelId,
    });
    await context.reinitializeGrok();

    const configuredProviders = Object.keys(context.configManager.getAllProviderCredentials());
    const configuredSummary =
      configuredProviders.length > 0 ? configuredProviders.join(', ') : 'none';
    display.successText(`Connected to ${providerInfo.name} (${modelId})`);
    display.muted(`Configured providers: ${configuredSummary}`);
  } catch (error) {
    display.errorText('Error: ' + error);
  }

  return true;
}

async function runLoginWizard(context: CommandContext, requestedProvider?: string): Promise<boolean> {
  const canPrompt = !!context.tuiApp || (process.stdin.isTTY && process.stdout.isTTY);
  if (!canPrompt) {
    display.appendAssistantMessage(renderLoginHelp());
    return true;
  }

  const configuredProviders = Object.keys(context.configManager.getAllProviderCredentials());
  const currentProvider = context.configManager.getProvider() || 'xai';
  const providerSeed =
    requestedProvider && isSupportedProvider(requestedProvider) ? requestedProvider : currentProvider;

  display.appendAssistantMessage(renderProviderWizardBlock(currentProvider, configuredProviders));
  const providerInput = await promptText(
    context,
    'Provider [number|id]',
    providerSeed,
  );
  const providerId = normalizeProviderChoice(providerInput, providerSeed);
  if (!providerId) {
    display.errorText(`Unknown provider selection: "${providerInput}"`);
    display.muted(`Available: ${SUPPORTED_PROVIDER_IDS.join(', ')}`);
    return true;
  }

  const providerInfo = PROVIDERS[providerId];
  const existingApiKey = context.configManager.getProviderCredentials(providerId)?.apiKey || '';
  if (existingApiKey) {
    display.muted(
      `${providerInfo.name} already has a configured key. Leave input empty to keep existing key.`,
    );
  }

  const apiKeyInput = await promptSecret(context, `Step 2/3 - API key for ${providerId}`);
  const apiKey = apiKeyInput.trim() || existingApiKey;
  if (!apiKey) {
    display.errorText('API key is required for this provider.');
    return true;
  }

  const defaultModel = resolveDefaultModel(context, providerId);
  display.appendAssistantMessage(renderModelWizardBlock(providerId, defaultModel));
  const modelInput = await promptText(
    context,
    'Model [number|id]',
    defaultModel,
  );
  const modelId = resolveModelChoice(modelInput, providerId, defaultModel);

  return await applyLoginSelection(context, providerId, apiKey, modelId);
}

export const loginCommand: CommandHandler = {
  name: 'login',
  description: 'Interactive login wizard (provider, API key, model)',
  usage: '/login [provider|api_key] [api_key|provider] [model]',
  subcommands: ['wizard'],
  group: 'Session',
  execute: async (args, context) => {
    const trimmedArgs = args.map(a => a.trim()).filter(Boolean);
    if (trimmedArgs.length === 0) {
      return await runLoginWizard(context);
    }

    const first = trimmedArgs[0].toLowerCase();
    if (first === 'wizard') {
      const requestedProvider = trimmedArgs[1]?.toLowerCase();
      return await runLoginWizard(context, requestedProvider);
    }

    if (first === 'help' || first === '--help' || first === '-h') {
      display.appendAssistantMessage(renderLoginHelp());
      return true;
    }

    let providerId = '';
    let apiKey = '';
    let modelArg = '';

    if (isSupportedProvider(first)) {
      providerId = first;
      if (trimmedArgs.length === 1) {
        return await runLoginWizard(context, providerId);
      }
      apiKey = trimmedArgs[1];
      modelArg = trimmedArgs.slice(2).join(' ').trim();
    } else {
      apiKey = trimmedArgs[0];
      providerId = inferProviderFromKey(apiKey) || context.configManager.getProvider() || 'xai';
      if (trimmedArgs[1] && isSupportedProvider(trimmedArgs[1].toLowerCase())) {
        providerId = trimmedArgs[1].toLowerCase();
        modelArg = trimmedArgs.slice(2).join(' ').trim();
      } else {
        modelArg = trimmedArgs.slice(1).join(' ').trim();
      }
    }

    if (!providerId || !isSupportedProvider(providerId)) {
      display.errorText(`Unknown provider: ${providerId}`);
      display.muted(`Available: ${SUPPORTED_PROVIDER_IDS.join(', ')}`);
      return true;
    }

    const inferred = inferProviderFromKey(apiKey);
    if (inferred && inferred !== providerId) {
      display.warningText(
        `API key format suggests "${inferred}" but selected provider is "${providerId}".`,
      );
    }

    const modelId = modelArg || resolveDefaultModel(context, providerId);
    return await applyLoginSelection(context, providerId, apiKey, modelId);
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

    display.appendAssistantMessage(t`
${bold(fg(theme.accent)('Slashbot Configuration'))}

  Status:     ${isAuth ? 'Connected' : 'Not connected'}
  Provider:   ${providerName}
  Model:      ${currentModel}
  Config:     ${configDir}${providersList}
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

      display.appendAssistantMessage(t`
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
          return `  ${marker} ${info.id} (${info.name})${status}`;
        })
        .join('\n');

      display.appendAssistantMessage(t`
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
      display.appendAssistantMessage(t`${fg(theme.error)('Unknown provider: ' + providerArg)}
${fg(theme.muted)('Available: ' + Object.keys(PROVIDERS).join(', '))}`);
      return true;
    }

    // Check if provider is configured
    const creds = context.configManager.getProviderCredentials(providerArg);
    if (!creds) {
      display.appendAssistantMessage(t`${fg(theme.error)("Provider '" + providerArg + "' not configured.")}
${fg(theme.muted)('Set ' + providerInfo.envVars[0] + ' environment variable, or /login with the API key.')}`);
      return true;
    }

    // Switch provider
    context.grokClient.setProvider(providerArg, creds.apiKey);
    await context.configManager.saveApiKey(creds.apiKey);
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
