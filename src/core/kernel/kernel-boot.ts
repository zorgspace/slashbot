/**
 * @module kernel-boot
 *
 * Boot / initialisation logic extracted from the kernel.
 * Handles plugin discovery, topological sorting, plugin registration,
 * provider config merging, and gateway catalog fetching.
 */

import { join } from 'node:path';
import type {
  HookDomain,
  HookExecutionContext,
  HookRegistration,
  PluginDiagnostic,
  PluginRegistrationContext,
  RuntimeConfig
} from './contracts.js';
import type { HookDispatcher } from './hook-dispatcher.js';
import type { PromptAssembler } from './prompt-assembler.js';
import type { EventBus } from './event-bus.js';
import type {
  ChannelRegistry,
  CommandRegistry,
  GatewayMethodRegistry,
  HttpRouteRegistry,
  ProviderRegistry,
  ServiceRegistry,
  StatusIndicatorRegistry,
  ToolRegistry
} from './registries.js';
import type { StructuredLogger } from './contracts.js';
import type { BundledPluginFactory, LoadedPlugin } from '../plugins/loader.js';
import { registerPluginSafely } from '../plugins/loader.js';
import { discoverPlugins, type DiscoveredPlugin } from '../plugins/discovery.js';
import { registerConfigHooks } from './config-hook-loader.js';
import { attachInteractionLogger } from './interaction-logger.js';
import { loadProvidersConfig } from '../config/providers-config.js';
import { applyProvidersConfig } from '../config/providers-merge.js';
import { fetchGatewayCatalog } from '../config/gateway-catalog.js';
import { registerGatewayVendor } from '../agentic/llm/provider-registry.js';

// ---------------------------------------------------------------------------
// Plugin ownership guard
// ---------------------------------------------------------------------------

function assertPluginOwnership(
  actualId: string,
  expectedId: string,
  contributionKind: string,
  contributionId: string
): void {
  if (actualId !== expectedId) {
    throw new Error(
      `${contributionKind} ${contributionId} declares pluginId=${actualId} but current plugin context is ${expectedId}`
    );
  }
}

// ---------------------------------------------------------------------------
// Topological sort of discovered plugins
// ---------------------------------------------------------------------------

export function sortPlugins(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
  const byId = new Map(plugins.map((item) => [item.manifest.id, item]));
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();

  for (const plugin of plugins) {
    indegree.set(plugin.manifest.id, 0);
    edges.set(plugin.manifest.id, []);
  }

  for (const plugin of plugins) {
    for (const dependency of plugin.manifest.dependencies ?? []) {
      if (!byId.has(dependency)) {
        continue;
      }
      indegree.set(plugin.manifest.id, (indegree.get(plugin.manifest.id) ?? 0) + 1);
      edges.get(dependency)!.push(plugin.manifest.id);
    }
  }

  const queue = [...plugins]
    .filter((item) => (indegree.get(item.manifest.id) ?? 0) === 0)
    .sort((a, b) => {
      const aPriority = a.manifest.priority ?? 100;
      const bPriority = b.manifest.priority ?? 100;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return a.manifest.id.localeCompare(b.manifest.id);
    });

  const result: DiscoveredPlugin[] = [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    result.push(next);

    for (const dependentId of edges.get(next.manifest.id) ?? []) {
      const remaining = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, remaining);
      if (remaining === 0) {
        queue.push(byId.get(dependentId)!);
        queue.sort((a, b) => {
          const aPriority = a.manifest.priority ?? 100;
          const bPriority = b.manifest.priority ?? 100;
          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }
          return a.manifest.id.localeCompare(b.manifest.id);
        });
      }
    }
  }

  if (result.length !== plugins.length) {
    const unresolved = plugins
      .filter((plugin) => !result.some((item) => item.manifest.id === plugin.manifest.id))
      .map((plugin) => plugin.manifest.id)
      .sort();
    throw new Error(`Plugin dependency cycle detected among: ${unresolved.join(', ')}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Plugin registration context factory
// ---------------------------------------------------------------------------

/**
 * Dependencies needed to build a {@link PluginRegistrationContext}.
 *
 * Deliberately a plain interface so this module never imports the kernel class.
 */
export interface RegistrationContextDeps {
  tools: ToolRegistry;
  commands: CommandRegistry;
  hooks: HookDispatcher;
  providers: ProviderRegistry;
  gatewayMethods: GatewayMethodRegistry;
  httpRoutes: HttpRouteRegistry;
  services: ServiceRegistry;
  channels: ChannelRegistry;
  promptAssembler: PromptAssembler;
  statusIndicators: StatusIndicatorRegistry;
  logger: StructuredLogger;
}

/**
 * Build the {@link PluginRegistrationContext} for a specific plugin.
 *
 * @param pluginId - The plugin being registered
 * @param deps     - Kernel subsystem references
 */
export function createPluginRegistrationContext(
  pluginId: string,
  deps: RegistrationContextDeps
): PluginRegistrationContext {
  return {
    registerTool: (tool) => {
      assertPluginOwnership(tool.pluginId, pluginId, 'Tool', tool.id);
      deps.tools.register(tool);
    },
    registerCommand: (command) => {
      assertPluginOwnership(command.pluginId, pluginId, 'Command', command.id);
      deps.commands.register(command);
    },
    registerHook: (hook) => {
      assertPluginOwnership(hook.pluginId, pluginId, 'Hook', hook.id);
      deps.hooks.register(hook as HookRegistration<Record<string, unknown>>);
    },
    registerProvider: (provider) => {
      assertPluginOwnership(provider.pluginId, pluginId, 'Provider', provider.id);
      deps.providers.register(provider);
    },
    registerGatewayMethod: (method) => {
      assertPluginOwnership(method.pluginId, pluginId, 'Gateway method', method.id);
      deps.gatewayMethods.register(method);
    },
    registerHttpRoute: (route) => {
      assertPluginOwnership(route.pluginId, pluginId, 'HTTP route', `${route.method}:${route.path}`);
      deps.httpRoutes.register(route);
    },
    registerService: (service) => {
      assertPluginOwnership(service.pluginId, pluginId, 'Service', service.id);
      deps.services.register(service);
    },
    getService: (serviceId: string) => deps.services.get(serviceId),
    registerChannel: (channel) => {
      assertPluginOwnership(channel.pluginId, pluginId, 'Channel', channel.id);
      deps.channels.register(channel);
    },
    contributePromptSection: (section) => {
      assertPluginOwnership(section.pluginId, pluginId, 'Prompt section', section.id);
      deps.promptAssembler.registerSection(section);
    },
    contributeContextProvider: (provider) => {
      assertPluginOwnership(provider.pluginId, pluginId, 'Context provider', provider.id);
      deps.promptAssembler.registerContextProvider(provider);
    },
    contributeStatusIndicator: (indicator) => {
      assertPluginOwnership(indicator.pluginId, pluginId, 'StatusIndicator', indicator.id);
      deps.statusIndicators.register(indicator);
      return (status) => deps.statusIndicators.updateStatus(indicator.id, status);
    },
    dispatchHook: <T extends Record<string, unknown>>(
      domain: HookDomain,
      event: string,
      payload: T,
      context?: HookExecutionContext
    ) => deps.hooks.dispatchAny(domain, event, payload, context ?? {}),
    logger: deps.logger
  };
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

/**
 * All mutable state that the boot sequence pushes into.
 */
export interface BootTargets {
  loadedPlugins: LoadedPlugin[];
  diagnostics: PluginDiagnostic[];
}

/**
 * Options forwarded from `KernelCreateOptions`.
 */
export interface BootOptions {
  workspaceRoot: string;
  config: RuntimeConfig;
  bundledPlugins: Record<string, BundledPluginFactory>;
  bundledDiscovered: DiscoveredPlugin[];
}

/**
 * Run the full kernel boot sequence:
 *
 * 1. Register config-driven hooks
 * 2. Attach the interaction logger
 * 3. Discover, sort, and register plugins
 * 4. Merge user provider overrides
 * 5. Fetch the dynamic gateway model catalog
 *
 * @param opts    - Boot options (workspace root, config, bundled plugins)
 * @param deps    - Kernel subsystem references for building registration contexts
 * @param targets - Mutable collections to push results into
 */
export async function bootKernel(
  opts: BootOptions,
  deps: RegistrationContextDeps & { events: EventBus; providers: ProviderRegistry },
  targets: BootTargets
): Promise<void> {
  // 1. Config-driven hooks
  registerConfigHooks(opts.config, deps.hooks, opts.workspaceRoot, deps.logger);

  // 2. Interaction logger
  attachInteractionLogger(
    deps.events,
    join(opts.workspaceRoot, '.slashbot', 'logs'),
  );

  // 3. Plugin discovery & registration
  const discovery = await discoverPlugins(
    opts.config.plugins,
    opts.workspaceRoot,
    opts.bundledDiscovered
  );

  const ordered = sortPlugins(discovery.plugins);
  targets.diagnostics.push(...discovery.diagnostics);

  for (const plugin of ordered) {
    const ctx = createPluginRegistrationContext(plugin.manifest.id, deps);
    const result = await registerPluginSafely(
      plugin,
      ctx,
      deps.logger,
      opts.bundledPlugins
    );

    if (result.loaded) {
      targets.loadedPlugins.push(result.loaded);
    }

    targets.diagnostics.push(result.diagnostic);
  }

  // 4. Provider config overrides
  try {
    const providersConfig = await loadProvidersConfig();
    if (providersConfig) {
      applyProvidersConfig(providersConfig, deps.providers, deps.logger);
    }
  } catch (error) {
    deps.logger.warn('Failed to load providers.json', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // 5. Gateway model catalog
  const gatewayCatalog = await fetchGatewayCatalog(deps.logger);
  if (gatewayCatalog.length > 0) {
    const gatewayProvider = deps.providers.get('gateway');
    if (gatewayProvider) {
      deps.providers.upsert({ ...gatewayProvider, models: gatewayCatalog });
    }

    const byVendor = new Map<string, typeof gatewayCatalog>();
    for (const model of gatewayCatalog) {
      const slash = model.id.indexOf('/');
      if (slash < 1) continue;
      const vendor = model.id.slice(0, slash);
      const shortId = model.id.slice(slash + 1);
      const list = byVendor.get(vendor) ?? [];
      list.push({ ...model, id: shortId });
      byVendor.set(vendor, list);
    }

    for (const [vendorId, models] of byVendor) {
      const existing = deps.providers.get(vendorId);
      if (existing) {
        deps.providers.upsert({ ...existing, models });
      } else {
        registerGatewayVendor(vendorId);
        deps.providers.upsert({
          id: vendorId,
          pluginId: 'kernel',
          displayName: vendorId,
          models,
          authHandlers: [],
          preferredAuthOrder: ['api_key'],
        });
      }
    }
  }
}
