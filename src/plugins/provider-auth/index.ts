/**
 * @module plugins/provider-auth
 *
 * Provider Auth plugin handling authentication and switching for LLM providers.
 * Registers the Vercel AI Gateway as the built-in provider and exposes commands
 * for provider onboarding, selection, and model switching.
 *
 * Commands:
 *  - `/setup`      -- Run provider onboarding (supports --provider, --method, --label, --api-key).
 *  - `/providers`  -- Show active provider or switch with `select <name>`.
 *  - `/model`      -- Show active model or switch with `select <id>`.
 *
 * @see {@link createProviderAuthPlugin} -- Plugin factory function
 */
import type { ProviderDefinition, ProviderModel, RuntimeConfig, SlashbotPlugin } from '../../plugin-sdk';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import type { ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import { saveRuntimeConfig } from '@slashbot/core/config/runtime-config.js';
import { createAllProviders } from '@slashbot/providers/index.js';
import { createGatewayCommands } from '@slashbot/providers/gateway-provider.js';
import type { PickerBridge } from '@slashbot/core/kernel/picker-bridge.js';
import type { PickerItem } from '@slashbot/ui/picker-overlay.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'provider:changed': { providerId: string; modelId: string };
  }
}

const PLUGIN_ID = 'slashbot.providers.auth';

function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ctx`;
  return `${n} ctx`;
}

type ActiveProviderSelection = RuntimeConfig['providers']['active'];

interface ProviderDisplayRow {
  id: string;
  isActive: boolean;
  modelName: string;
  contextWindow: string;
}

function selectDisplayModel(provider: ProviderDefinition, active: ActiveProviderSelection): ProviderModel | undefined {
  if (active?.providerId === provider.id) {
    return provider.models.find((model) => model.id === active.modelId) ?? provider.models[0];
  }
  return provider.models[0];
}

function buildProviderDisplayRows(providers: ProviderDefinition[], active: ActiveProviderSelection): ProviderDisplayRow[] {
  return providers.map((provider) => {
    const model = selectDisplayModel(provider, active);
    return {
      id: provider.id,
      isActive: provider.id === active?.providerId,
      modelName: model?.displayName ?? '—',
      contextWindow: model ? formatContextWindow(model.contextWindow) : '',
    };
  });
}

function buildProviderPickerItems(providers: ProviderDefinition[], active: ActiveProviderSelection): PickerItem[] {
  return buildProviderDisplayRows(providers, active).map((row) => ({
    id: row.id,
    label: row.id,
    description: `${row.modelName}  ${row.contextWindow}`,
    active: row.isActive,
  }));
}

function renderProvidersOverview(providers: ProviderDefinition[], active: ActiveProviderSelection): string {
  if (providers.length === 0) {
    return 'No providers configured.\n';
  }

  const rows = buildProviderDisplayRows(providers, active);
  const maxId = Math.max(...rows.map((row) => row.id.length));
  const maxModel = Math.max(...rows.map((row) => row.modelName.length));
  const activeId = active?.providerId ?? 'none';
  const activeModelId = active?.modelId ?? 'none';

  let output = '\nProviders\n\n';
  for (const row of rows) {
    const marker = row.isActive ? '\u25cf' : ' ';
    const id = row.id.padEnd(maxId);
    const model = row.modelName.padEnd(maxModel);
    output += `  ${marker} ${id}  ${model}  ${row.contextWindow}\n`;
  }
  output += `\nActive: ${activeId} (${activeModelId})\n`;
  output += 'Use /providers select to switch.\n';
  return output;
}

function buildModelPickerItems(provider: ProviderDefinition, activeModelId: string): PickerItem[] {
  return provider.models.map((model) => ({
    id: model.id,
    label: model.id,
    description: `${model.displayName}  ${formatContextWindow(model.contextWindow)}`,
    active: model.id === activeModelId,
  }));
}

function formatModelLine(model: ProviderModel, activeModelId?: string): string {
  const marker = model.id === activeModelId ? ' *' : '';
  return `  ${model.id}${marker} — ${model.displayName}`;
}

function buildModelLines(provider: ProviderDefinition | undefined, activeModelId?: string): string[] {
  return provider?.models.map((model) => formatModelLine(model, activeModelId)) ?? [];
}

/**
 * Create the Provider Auth plugin.
 *
 * Registers the Vercel AI Gateway as the sole built-in provider,
 * giving unified access to all models via a single API key.
 * Exposes `/setup`, `/providers`, and `/model` commands for provider
 * management and model selection.
 *
 * @returns A SlashbotPlugin instance with provider registrations and auth commands.
 */
export function createProviderAuthPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Provider Auth',
      version: '0.1.0',
      main: 'bundled',
      description: 'Auth plugin for LLM providers'
    },
    setup: (context) => {
      for (const provider of createAllProviders(PLUGIN_ID)) {
        context.registerProvider(provider);
      }

      const getKernel = () => {
        const kernel = context.getService<SlashbotKernel>('kernel.instance');
        if (!kernel) {
          throw new Error('kernel.instance service not available');
        }
        return kernel;
      };

      const runtimeConfig = context.getService<RuntimeConfig>('kernel.config')!;
      const events = context.getService<EventBus>('kernel.events')!;
      const providersRegistry = context.getService<ProviderRegistry>('kernel.providers.registry')!;

      // Register gateway-specific setup commands
      for (const command of createGatewayCommands(PLUGIN_ID, getKernel)) {
        context.registerCommand(command);
      }

      // Register unified setup command
      context.registerCommand({
        id: 'setup',
        pluginId: PLUGIN_ID,
        description: 'Run provider onboarding (use --provider to select)',
        execute: async (_args, commandContext) => {
          const { runOnboarding } = await import('@slashbot/ui/onboarding.js');
          const flags = commandContext.flags ?? {};
          const providerId = typeof flags['provider'] === 'string' ? flags['provider'] : 'gateway';
          const method = typeof flags['method'] === 'string' ? flags['method'] : undefined;
          await runOnboarding(getKernel(), {
            agentId: typeof flags['agent-id'] === 'string' ? flags['agent-id'] : 'default-agent',
            providerId,
            method: method as import('../../plugin-sdk').ProviderAuthMethod | undefined,
            profileLabel: typeof flags['label'] === 'string' ? flags['label'] : undefined,
            nonInteractive: commandContext.nonInteractive,
            apiKey: typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
            setupToken: typeof flags['setup-token'] === 'string' ? flags['setup-token'] : undefined,
            code: typeof flags['code'] === 'string' ? flags['code'] : undefined,
            state: typeof flags['state'] === 'string' ? flags['state'] : undefined,
            verifier: typeof flags['verifier'] === 'string' ? flags['verifier'] : undefined
          });
          return 0;
        }
      });

      // ── /providers command (merged from /provider + /providers) ──────
      context.registerCommand({
        id: 'providers',
        pluginId: PLUGIN_ID,
        description: 'Show or switch the active LLM provider',
        subcommands: ['select'],
        execute: async (args, commandContext) => {
          const active = runtimeConfig.providers.active;
          const sub = args[0];

          if (sub === 'select') {
            let name = args[1]?.toLowerCase();

            if (!name) {
              // Try interactive picker via bridge
              const picker = context.getService<PickerBridge>('kernel.pickerBridge');
              if (picker) {
                const items = buildProviderPickerItems(providersRegistry.list(), active);
                const result = await picker.request('Select provider', items);
                if (result.selected) {
                  name = result.selected;
                } else {
                  return 0;
                }
              } else {
                const available = providersRegistry.list().map(p => p.id);
                commandContext.stderr.write(`Usage: /providers select <name>\nAvailable: ${available.join(', ')}\n`);
                return 1;
              }
            }

            // Verify provider exists
            const provider = providersRegistry.get(name);
            if (!provider) {
              const available = providersRegistry.list().map(p => p.id);
              commandContext.stderr.write(`Unknown provider: ${name}\nAvailable: ${available.join(', ')}\n`);
              return 1;
            }

            const modelId = active?.providerId === name
              ? active.modelId
              : provider.models[0]?.id ?? name;
            runtimeConfig.providers.active = { providerId: name, modelId };
            await saveRuntimeConfig(runtimeConfig);

            events.publish('provider:changed', { providerId: name, modelId });
            commandContext.stdout.write(`Active provider: ${name} (model: ${modelId})\n`);
            return 0;
          }

          // Default: formatted provider list
          const allProviders = providersRegistry.list();
          commandContext.stdout.write(renderProvidersOverview(allProviders, active));
          return 0;
        }
      });

      // ── /model command ───────────────────────────────────────────────
      context.registerCommand({
        id: 'model',
        pluginId: PLUGIN_ID,
        description: 'Show or switch the active model',
        subcommands: ['select'],
        execute: async (args, commandContext) => {
          const active = runtimeConfig.providers.active;
          const sub = args[0];


          if (sub === 'select') {
            let modelId = args[1];

            if (!modelId) {
              if (!active) {
                commandContext.stderr.write('No provider configured.\n');
                return 1;
              }
              const picker = context.getService<PickerBridge>('kernel.pickerBridge');
              const currentProvider = providersRegistry.get(active.providerId);
              if (picker && currentProvider && currentProvider.models.length > 0) {
                const items = buildModelPickerItems(currentProvider, active.modelId);
                const result = await picker.request(`Select model (${active.providerId})`, items);
                if (result.selected) {
                  modelId = result.selected;
                } else {
                  return 0;
                }
              } else {
                const models = buildModelLines(currentProvider);
                commandContext.stderr.write(`Usage: /model select <model-id>\nAvailable for ${active.providerId}:\n${models.join('\n')}\n`);
                return 1;
              }
            }

            // Try to find which provider owns this model
            let targetProviderId: string | undefined;
            for (const p of providersRegistry.list()) {
              if (p.models.some(m => m.id === modelId)) {
                targetProviderId = p.id;
                break;
              }
            }

            if (targetProviderId) {
              runtimeConfig.providers.active = { providerId: targetProviderId, modelId };
              await saveRuntimeConfig(runtimeConfig);
              events.publish('provider:changed', { providerId: targetProviderId, modelId });
              commandContext.stdout.write(`Active model: ${modelId} (provider: ${targetProviderId})\n`);
            } else {
              // Unknown model — apply to current provider as a custom model ID
              if (!active) {
                commandContext.stderr.write('No provider configured.\n');
                return 1;
              }
              runtimeConfig.providers.active = { ...active, modelId };
              await saveRuntimeConfig(runtimeConfig);
              events.publish('provider:changed', { providerId: active.providerId, modelId });
              commandContext.stdout.write(`Active model: ${modelId} (provider: ${active.providerId})\n`);
            }
            return 0;
          }

          // Default: show current model and list alternatives
          if (!active) {
            commandContext.stdout.write('No provider configured.\n');
            return 0;
          }
          const provider = providersRegistry.get(active.providerId);
          commandContext.stdout.write(`Active: ${active.modelId} (${active.providerId})\n`);
          if (provider && provider.models.length > 1) {
            commandContext.stdout.write(`\nAvailable for ${active.providerId}:\n`);
            for (const line of buildModelLines(provider, active.modelId)) {
              commandContext.stdout.write(`${line}\n`);
            }
          }
          commandContext.stdout.write('\nUse /model select to switch.\n');
          return 0;
        }
      });
    }
  };
}

/** Alias for {@link createProviderAuthPlugin} conforming to the bundled plugin loader convention. */
export { createProviderAuthPlugin as createPlugin };
