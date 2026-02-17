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
import type { RuntimeConfig, SlashbotPlugin } from '../../plugin-sdk';
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
                const items: PickerItem[] = providersRegistry.list().map(p => {
                  const isActive = p.id === active?.providerId;
                  const model = isActive
                    ? p.models.find(m => m.id === active?.modelId) ?? p.models[0]
                    : p.models[0];
                  return {
                    id: p.id,
                    label: p.id,
                    description: `${model?.displayName ?? '—'}  ${model ? formatContextWindow(model.contextWindow) : ''}`,
                    active: isActive,
                  };
                });
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
          if (allProviders.length === 0) {
            commandContext.stdout.write('No providers configured.\n');
            return 0;
          }

          const activeId = active?.providerId ?? null;
          const activeModelId = active?.modelId ?? null;

          // Compute column widths
          const maxId = Math.max(...allProviders.map(p => p.id.length));
          const rows = allProviders.map(p => {
            const isActive = p.id === activeId;
            const model = isActive
              ? p.models.find(m => m.id === activeModelId) ?? p.models[0]
              : p.models[0];
            return {
              id: p.id,
              isActive,
              modelName: model?.displayName ?? '—',
              ctx: model ? formatContextWindow(model.contextWindow) : '',
            };
          });
          const maxModel = Math.max(...rows.map(r => r.modelName.length));

          commandContext.stdout.write('\nProviders\n\n');
          for (const row of rows) {
            const marker = row.isActive ? '\u25cf' : ' ';
            const id = row.id.padEnd(maxId);
            const model = row.modelName.padEnd(maxModel);
            commandContext.stdout.write(`  ${marker} ${id}  ${model}  ${row.ctx}\n`);
          }
          commandContext.stdout.write(`\nActive: ${activeId ?? 'none'} (${activeModelId ?? 'none'})\n`);
          commandContext.stdout.write('Use /providers select to switch.\n');
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
                const items: PickerItem[] = currentProvider.models.map(m => ({
                  id: m.id,
                  label: m.id,
                  description: `${m.displayName}  ${formatContextWindow(m.contextWindow)}`,
                  active: m.id === active.modelId,
                }));
                const result = await picker.request(`Select model (${active.providerId})`, items);
                if (result.selected) {
                  modelId = result.selected;
                } else {
                  return 0;
                }
              } else {
                const provider = currentProvider;
                const models = provider?.models.map(m => `  ${m.id} — ${m.displayName}`) ?? [];
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
            for (const m of provider.models) {
              const marker = m.id === active.modelId ? ' *' : '';
              commandContext.stdout.write(`  ${m.id}${marker} — ${m.displayName}\n`);
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
