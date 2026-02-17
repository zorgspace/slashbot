/**
 * @module kernel
 *
 * Core orchestrator for the Slashbot plugin system. Manages plugin lifecycle,
 * tool/command/provider registries, hook dispatching, session management,
 * gateway lifecycle, and prompt assembly.
 *
 * @see {@link SlashbotKernel} - Main kernel class
 * @see {@link KernelCreateOptions} - Options for kernel instantiation
 */

import { randomUUID } from 'node:crypto';
import { promises as fs, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function _ilogKernel(msg: string): void {
  try { appendFileSync('/tmp/slashbot-ilog.log', `[kernel ${new Date().toISOString()}] ${msg}\n`); } catch {}
}
import type {
  CommandExecutionContext,
  HealthStatus,
  HookDomain,
  HookExecutionContext,
  HookRegistration,
  JsonValue,
  PathResolver,
  PluginDiagnostic,
  PluginRegistrationContext,
  RuntimeConfig,
  RuntimeFlags,
  ToolCallContext,
  ToolResult
} from './contracts.js';
import { EventBus } from './event-bus.js';
import { PromptAssembler } from './prompt-assembler.js';
import { HookDispatcher } from './hook-dispatcher.js';
import {
  ChannelRegistry,
  CommandRegistry,
  GatewayMethodRegistry,
  HttpRouteRegistry,
  ProviderRegistry,
  ServiceRegistry,
  StatusIndicatorRegistry,
  ToolRegistry
} from './registries.js';
import { createLogger } from './logger.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { loadProvidersConfig } from '../config/providers-config.js';
import { applyProvidersConfig } from '../config/providers-merge.js';
import { fetchGatewayCatalog } from '../config/gateway-catalog.js';
import { registerGatewayVendor } from '../agentic/llm/provider-registry.js';
import { AuthProfileStore } from '../auth/profile-store.js';
import { AuthProfileRouter } from '../providers/auth-router.js';
import { SlashbotGateway } from '../gateway/server.js';
import type { BundledPluginFactory, LoadedPlugin } from '../plugins/loader.js';
import { registerPluginSafely } from '../plugins/loader.js';
import { discoverPlugins, type DiscoveredPlugin } from '../plugins/discovery.js';
import { registerConfigHooks } from './config-hook-loader.js';
import { attachInteractionLogger } from './interaction-logger.js';

/** Options for creating a new kernel instance via {@link SlashbotKernel.create}. */
export interface KernelCreateOptions {
  /** Root directory of the current workspace. */
  workspaceRoot: string;
  /** Optional CLI / runtime flags (e.g. non-interactive mode). */
  flags?: RuntimeFlags;
  /** Map of bundled plugin factory functions keyed by plugin ID. */
  bundledPlugins?: Record<string, BundledPluginFactory>;
  /** Pre-discovered bundled plugin manifests. */
  bundledDiscovered?: DiscoveredPlugin[];
}

function assertPluginOwnership(actualId: string, expectedId: string, contributionKind: string, contributionId: string): void {
  if (actualId !== expectedId) {
    throw new Error(
      `${contributionKind} ${contributionId} declares pluginId=${actualId} but current plugin context is ${expectedId}`
    );
  }
}

function sortPlugins(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
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

  for (const plugin of plugins) {
    if (!result.find((item) => item.manifest.id === plugin.manifest.id)) {
      result.push(plugin);
    }
  }

  return result;
}

/**
 * Main kernel class that orchestrates the entire Slashbot runtime.
 *
 * Manages plugin registration, tool execution, hook dispatching, session
 * persistence, gateway lifecycle, prompt assembly, and authentication routing.
 * Created exclusively via the static {@link SlashbotKernel.create} factory.
 */
export class SlashbotKernel {
  /** Resolved runtime configuration for the current workspace. */
  readonly config: RuntimeConfig;
  /** Structured logger scoped to the configured log level. */
  readonly logger;
  /** Registry of all registered tools. */
  readonly tools = new ToolRegistry();
  /** Registry of all registered CLI commands. */
  readonly commands = new CommandRegistry();
  /** Registry of all registered LLM providers. */
  readonly providers = new ProviderRegistry();
  /** Registry of gateway JSON-RPC methods. */
  readonly gatewayMethods = new GatewayMethodRegistry();
  /** Registry of gateway HTTP routes. */
  readonly httpRoutes = new HttpRouteRegistry();
  /** Registry of inter-plugin services. */
  readonly services = new ServiceRegistry();
  /** Registry of messaging channels (connectors). */
  readonly channels = new ChannelRegistry();
  /** Registry of TUI status indicators. */
  readonly statusIndicators = new StatusIndicatorRegistry();
  /** Pub-sub event bus for cross-plugin communication. */
  readonly events = new EventBus();
  /** Assembles the full system prompt from all contributor sections. */
  readonly promptAssembler = new PromptAssembler();
  /** Dispatcher for kernel, lifecycle, and custom hooks. */
  readonly hooks: HookDispatcher;
  /** Persistent store for authentication profiles. */
  readonly authStore: AuthProfileStore;
  /** Routes auth requests to the correct provider/profile. */
  readonly authRouter: AuthProfileRouter;
  /** Resolves home and workspace directory paths. */
  readonly paths: PathResolver;

  private readonly loadedPlugins: LoadedPlugin[] = [];
  private readonly diagnostics: PluginDiagnostic[] = [];
  private gateway?: SlashbotGateway;
  private gatewayEventUnsubscribe?: () => void;

  private sessionFilePath(agentId: string, sessionId: string): string {
    return this.paths.home('agents', agentId, 'sessions', `${sessionId}.json`);
  }

  private constructor(
    readonly workspaceRoot: string,
    readonly flags: RuntimeFlags,
    config: RuntimeConfig
  ) {
    this.config = config;
    this.paths = {
      home: (...segments) => join(homedir(), '.slashbot', ...segments),
      workspace: (...segments) => join(workspaceRoot, '.slashbot', ...segments),
    };
    this.logger = createLogger(config.logging.level);
    this.hooks = new HookDispatcher(config, this.logger, (eventType, payload) => {
      this.events.publish(eventType, payload);
    });
    this.authStore = new AuthProfileStore(this.paths.home(), process.cwd(), this.workspaceRoot);
    this.authRouter = new AuthProfileRouter(this.providers, this.authStore, this.config, this.logger);
    this.services.register({
      id: 'kernel.health',
      pluginId: 'kernel',
      description: 'Kernel health accessor',
      implementation: () => this.health()
    });
    this.services.register({
      id: 'kernel.diagnostics',
      pluginId: 'kernel',
      description: 'Kernel plugin diagnostics accessor',
      implementation: () => this.diagnosticsReport()
    });
    this.services.register({
      id: 'kernel.providers',
      pluginId: 'kernel',
      description: 'Provider registry accessor',
      implementation: () => this.providers.list()
    });
    this.services.register({
      id: 'kernel.providers.registry',
      pluginId: 'kernel',
      description: 'Provider registry object',
      implementation: this.providers
    });
    this.services.register({
      id: 'kernel.channels',
      pluginId: 'kernel',
      description: 'Channel registry accessor',
      implementation: () => this.channels.list()
    });
    this.services.register({
      id: 'kernel.config',
      pluginId: 'kernel',
      description: 'Runtime config accessor',
      implementation: this.config
    });
    this.services.register({
      id: 'kernel.workspaceRoot',
      pluginId: 'kernel',
      description: 'Workspace root path',
      implementation: this.workspaceRoot
    });
    this.services.register({
      id: 'kernel.authRouter',
      pluginId: 'kernel',
      description: 'Auth router accessor',
      implementation: this.authRouter
    });
    this.services.register({
      id: 'kernel.logger',
      pluginId: 'kernel',
      description: 'Logger accessor',
      implementation: this.logger
    });
    this.services.register({
      id: 'kernel.runTool',
      pluginId: 'kernel',
      description: 'Tool execution accessor',
      implementation: (toolId: string, args: JsonValue, context: ToolCallContext = {}) =>
        this.runTool(toolId, args, context)
    });
    this.services.register({
      id: 'kernel.paths',
      pluginId: 'kernel',
      description: 'Path resolver for home and workspace directories',
      implementation: this.paths
    });
    this.services.register({
      id: 'kernel.events',
      pluginId: 'kernel',
      description: 'Event bus for pub-sub',
      implementation: this.events
    });
    this.services.register({
      id: 'kernel.assemblePrompt',
      pluginId: 'kernel',
      description: 'Assemble full system prompt from all contributors',
      implementation: () => this.assemblePrompt()
    });
    this.services.register({
      id: 'kernel.sendMessageLifecycle',
      pluginId: 'kernel',
      description: 'Send message lifecycle events',
      implementation: (
        event: 'message_received' | 'message_sending' | 'message_sent',
        sessionId: string,
        agentId: string,
        message: string
      ) => this.sendMessageLifecycle(event, sessionId, agentId, message)
    });
    this.services.register({
      id: 'kernel.tools.registry',
      pluginId: 'kernel',
      description: 'Tool registry for listing and getting tools',
      implementation: this.tools
    });
    this.services.register({
      id: 'kernel.commands.registry',
      pluginId: 'kernel',
      description: 'Command registry for listing and getting commands',
      implementation: this.commands
    });
    this.services.register({
      id: 'kernel.channels.registry',
      pluginId: 'kernel',
      description: 'Channel registry for getting channels by ID',
      implementation: this.channels
    });
    this.services.register({
      id: 'kernel.statusIndicators.registry',
      pluginId: 'kernel',
      description: 'Status indicator registry for UI',
      implementation: this.statusIndicators
    });
    this.services.register({
      id: 'kernel.loadedPlugins',
      pluginId: 'kernel',
      description: 'List loaded plugin IDs',
      implementation: () => this.listLoadedPlugins()
    });
    // Deprecated: plugins should use specific services above instead
    this.services.register({
      id: 'kernel.instance',
      pluginId: 'kernel',
      description: 'Kernel instance reference (deprecated — use specific services)',
      implementation: this
    });
  }

  /**
   * Create and fully initialise a kernel instance.
   *
   * Loads runtime config, discovers and registers plugins (in dependency order),
   * applies provider overrides, and fetches the gateway model catalog.
   *
   * @param options - Kernel creation options
   * @returns A fully initialised kernel ready for startup
   */
  static async create(options: KernelCreateOptions): Promise<SlashbotKernel> {
    const config = await loadRuntimeConfig(options.workspaceRoot, options.flags);
    const kernel = new SlashbotKernel(options.workspaceRoot, options.flags ?? {}, config);

    registerConfigHooks(config, kernel.hooks, options.workspaceRoot, kernel.logger);

    attachInteractionLogger(
      kernel.events,
      join(options.workspaceRoot, '.slashbot', 'logs'),
    );

    const discovery = await discoverPlugins(
      kernel.config.plugins,
      options.workspaceRoot,
      options.bundledDiscovered ?? []
    );

    const ordered = sortPlugins(discovery.plugins);
    kernel.diagnostics.push(...discovery.diagnostics);
    for (const plugin of ordered) {
      const result = await registerPluginSafely(
        plugin,
        kernel.createPluginRegistrationContext(plugin.manifest.id),
        kernel.logger,
        options.bundledPlugins ?? {}
      );

      if (result.loaded) {
        kernel.loadedPlugins.push(result.loaded);
      }

      kernel.diagnostics.push(result.diagnostic);
    }

    // Apply user providers.json overrides after all plugins have registered their providers
    try {
      const providersConfig = await loadProvidersConfig();
      if (providersConfig) {
        applyProvidersConfig(providersConfig, kernel.providers, kernel.logger);
      }
    } catch (error) {
      kernel.logger.warn('Failed to load providers.json', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    // Fetch dynamic model catalog for Vercel AI Gateway
    const gatewayCatalog = await fetchGatewayCatalog(kernel.logger);
    if (gatewayCatalog.length > 0) {
      // Update gateway provider with full catalog (vendor/model IDs)
      const gatewayProvider = kernel.providers.get('gateway');
      if (gatewayProvider) {
        kernel.providers.upsert({ ...gatewayProvider, models: gatewayCatalog });
      }

      // Group by vendor and upsert per-vendor providers with short model names
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
        const existing = kernel.providers.get(vendorId);
        if (existing) {
          kernel.providers.upsert({ ...existing, models });
        } else {
          // New vendor from catalog — register SDK factory and provider
          registerGatewayVendor(vendorId);
          kernel.providers.upsert({
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

    return kernel;
  }

  private createPluginRegistrationContext(pluginId: string): PluginRegistrationContext {
    return {
      registerTool: (tool) => {
        assertPluginOwnership(tool.pluginId, pluginId, 'Tool', tool.id);
        this.tools.register(tool);
      },
      registerCommand: (command) => {
        assertPluginOwnership(command.pluginId, pluginId, 'Command', command.id);
        this.commands.register(command);
      },
      registerHook: (hook) => {
        assertPluginOwnership(hook.pluginId, pluginId, 'Hook', hook.id);
        this.hooks.register(hook as HookRegistration<Record<string, unknown>>);
      },
      registerProvider: (provider) => {
        assertPluginOwnership(provider.pluginId, pluginId, 'Provider', provider.id);
        this.providers.register(provider);
      },
      registerGatewayMethod: (method) => {
        assertPluginOwnership(method.pluginId, pluginId, 'Gateway method', method.id);
        this.gatewayMethods.register(method);
      },
      registerHttpRoute: (route) => {
        assertPluginOwnership(route.pluginId, pluginId, 'HTTP route', `${route.method}:${route.path}`);
        this.httpRoutes.register(route);
      },
      registerService: (service) => {
        assertPluginOwnership(service.pluginId, pluginId, 'Service', service.id);
        this.services.register(service);
      },
      getService: (serviceId: string) => this.services.get(serviceId),
      registerChannel: (channel) => {
        assertPluginOwnership(channel.pluginId, pluginId, 'Channel', channel.id);
        this.channels.register(channel);
      },
      contributePromptSection: (section) => {
        assertPluginOwnership(section.pluginId, pluginId, 'Prompt section', section.id);
        this.promptAssembler.registerSection(section);
      },
      contributeContextProvider: (provider) => {
        assertPluginOwnership(provider.pluginId, pluginId, 'Context provider', provider.id);
        this.promptAssembler.registerContextProvider(provider);
      },
      contributeStatusIndicator: (indicator) => {
        assertPluginOwnership(indicator.pluginId, pluginId, 'StatusIndicator', indicator.id);
        this.statusIndicators.register(indicator);
        return (status) => this.statusIndicators.updateStatus(indicator.id, status);
      },
      dispatchHook: <T extends Record<string, unknown>>(
        domain: HookDomain,
        event: string,
        payload: T,
        context?: HookExecutionContext
      ) => this.hooks.dispatchAny(domain, event, payload, context ?? {}),
      logger: this.logger
    };
  }

  /**
   * Start the HTTP/WebSocket gateway server.
   * Dispatches the `gateway_start` lifecycle hook before binding.
   */
  async startGateway(): Promise<void> {
    if (this.gateway) {
      return;
    }

    const lifecycleReport = await this.hooks.dispatchLifecycle(
      'gateway_start',
      { gatewayHost: this.config.gateway.host, gatewayPort: this.config.gateway.port },
      {}
    );

    if (lifecycleReport.failures.length > 0) {
      this.logger.warn('gateway_start lifecycle had failures', {
        failures: lifecycleReport.failures.length
      });
    }

    this.gateway = new SlashbotGateway({
      config: this.config,
      methods: this.gatewayMethods,
      routes: this.httpRoutes,
      logger: this.logger,
      healthProvider: () => this.health()
    });

    await this.gateway.start();

    this.gatewayEventUnsubscribe?.();
    this.gatewayEventUnsubscribe = this.events.subscribeAll((event) => {
      this.gateway?.publishEvent(event.type, event.payload);
    });
  }

  /**
   * Stop the HTTP/WebSocket gateway server and clean up event forwarding.
   * Dispatches the `gateway_stop` lifecycle hook after shutdown.
   */
  async stopGateway(): Promise<void> {
    if (!this.gateway) {
      return;
    }

    this.gatewayEventUnsubscribe?.();
    this.gatewayEventUnsubscribe = undefined;

    await this.gateway.stop();
    this.gateway = undefined;

    const lifecycleReport = await this.hooks.dispatchLifecycle('gateway_stop', { stopped: true }, {});
    if (lifecycleReport.failures.length > 0) {
      this.logger.warn('gateway_stop lifecycle had failures', {
        failures: lifecycleReport.failures.length
      });
    }
  }

  /** Dispatch the kernel `startup` hook to all registered listeners. */
  async startup(): Promise<void> {
    const report = await this.hooks.dispatchKernel('startup', { ready: true }, {});
    if (report.failures.length > 0) {
      this.logger.warn('Kernel startup hooks had failures', { failures: report.failures.length });
    }
  }

  /** Dispatch the kernel `shutdown` hook and deactivate all loaded plugins. */
  async shutdown(): Promise<void> {
    const report = await this.hooks.dispatchKernel('shutdown', { done: true }, {});
    if (report.failures.length > 0) {
      this.logger.warn('Kernel shutdown hooks had failures', { failures: report.failures.length });
    }

    for (const plugin of this.loadedPlugins) {
      try {
        await plugin.instance.deactivate?.();
      } catch (error) {
        this.logger.warn('Plugin deactivation failed', {
          pluginId: plugin.manifest.id,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Execute a registered CLI command by ID.
   *
   * Dispatches `before_command` / `after_command` lifecycle hooks around execution.
   *
   * @param commandId - The unique command identifier
   * @param args - Positional arguments passed to the command
   * @param context - Execution context (cwd, streams, env, flags)
   * @returns The command exit code (0 = success)
   */
  async runCommand(commandId: string, args: string[], context: CommandExecutionContext): Promise<number> {
    const command = this.commands.get(commandId);
    if (!command) {
      context.stderr.write(`Unknown command: ${commandId}\n`);
      return 1;
    }

    await this.hooks.dispatchLifecycle(
      'before_command',
      { commandId, args },
      {}
    );

    const exitCode = await command.execute(args, context);

    await this.hooks.dispatchLifecycle(
      'after_command',
      { commandId, exitCode },
      {}
    );

    return exitCode;
  }

  /**
   * Execute a registered tool by ID.
   *
   * Dispatches `before_tool_call`, `after_tool_call`, and `tool_result_persist`
   * lifecycle hooks and publishes a `tool:result` event.
   *
   * @param toolId - The unique tool identifier
   * @param args - Arguments to pass to the tool handler
   * @param context - Optional execution context (session, agent, abort signal)
   * @returns Tool execution result
   */
  async runTool(toolId: string, args: JsonValue, context: ToolCallContext = {}): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${toolId}`
        }
      };
    }

    const before = await this.hooks.dispatchLifecycle(
      'before_tool_call',
      {
        toolId,
        requestId: context.requestId ?? randomUUID(),
        args
      },
      context
    );

    const effectiveArgs = (before.finalPayload.args ?? args) as JsonValue;
    let result: ToolResult;
    try {
      result = await tool.execute(effectiveArgs, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        error: { code: 'TOOL_EXECUTE_ERROR', message: `Tool ${toolId} threw: ${message}` }
      };
    }

    await this.hooks.dispatchLifecycle(
      'after_tool_call',
      {
        toolId,
        ok: result.ok,
        output: result.output ?? null,
        error: result.error?.message ?? null
      },
      context
    );

    this.events.publish('tool:result', {
      toolId,
      args: effectiveArgs as Record<string, JsonValue>,
      sessionId: context.sessionId ?? '',
      ok: result.ok,
      output: result.output ?? null,
      error: result.error?.message ?? null,
    });

    await this.hooks.dispatchLifecycle(
      'tool_result_persist',
      {
        toolId,
        persisted: true,
        requestId: context.requestId ?? randomUUID()
      },
      context
    );

    return result;
  }

  /** Return a snapshot of all plugin load diagnostics. */
  diagnosticsReport(): PluginDiagnostic[] {
    return [...this.diagnostics];
  }

  /** Compute the current kernel health status based on plugin diagnostics. */
  health(): HealthStatus {
    const failed = this.diagnostics.filter((item) => item.status === 'failed').length;
    const status: HealthStatus['status'] = failed > 0 ? 'degraded' : 'ok';

    return {
      status,
      details: {
        pluginsLoaded: this.diagnostics.filter((item) => item.status === 'loaded').length,
        pluginsFailed: failed,
        commandCount: this.commands.list().length,
        toolCount: this.tools.list().length,
        providerCount: this.providers.list().length,
        gatewayMethodCount: this.gatewayMethods.list().length
      }
    };
  }

  /** Return the IDs of all successfully loaded plugins. */
  listLoadedPlugins(): string[] {
    return this.loadedPlugins.map((item) => item.manifest.id);
  }

  /**
   * Assemble the full system prompt from all registered sections and context providers.
   * Dispatches `before_prompt_assemble` / `after_prompt_assemble` lifecycle hooks.
   * @returns The concatenated system prompt string
   */
  async assemblePrompt(): Promise<string> {
    await this.hooks.dispatchLifecycle('before_prompt_assemble', {}, {});

    const result = await this.promptAssembler.assemble();

    await this.hooks.dispatchLifecycle('after_prompt_assemble', { prompt: result }, {});

    return result;
  }

  /**
   * Start a new session, persisting metadata to disk and dispatching lifecycle hooks.
   * @param sessionId - Unique session identifier
   * @param agentId - ID of the agent owning the session
   */
  async startSession(sessionId: string, agentId: string): Promise<void> {
    const sessionPath = this.sessionFilePath(agentId, sessionId);
    await fs.mkdir(this.paths.home('agents', agentId, 'sessions'), { recursive: true });
    await fs.writeFile(
      sessionPath,
      `${JSON.stringify(
        {
          sessionId,
          agentId,
          startedAt: new Date().toISOString(),
          status: 'active'
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    this.events.publish('lifecycle:session_start', {
      sessionId,
      agentId,
    });

    await this.hooks.dispatchLifecycle(
      'session_start',
      {
        sessionId,
        agentId,
        startedAt: new Date().toISOString()
      },
      { sessionId, agentId }
    );
  }

  /**
   * End an active session, updating its persisted metadata and dispatching lifecycle hooks.
   * @param sessionId - Unique session identifier
   * @param agentId - ID of the agent owning the session
   */
  async endSession(sessionId: string, agentId: string): Promise<void> {
    const sessionPath = this.sessionFilePath(agentId, sessionId);
    try {
      const existing = await fs.readFile(sessionPath, 'utf8');
      const parsed = JSON.parse(existing) as Record<string, unknown>;
      await fs.writeFile(
        sessionPath,
        `${JSON.stringify(
          {
            ...parsed,
            endedAt: new Date().toISOString(),
            status: 'ended'
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    } catch {
      // Session metadata persistence should not block lifecycle cleanup.
    }

    this.events.publish('lifecycle:session_end', {
      sessionId,
      agentId,
    });

    await this.hooks.dispatchLifecycle(
      'session_end',
      {
        sessionId,
        agentId,
        endedAt: new Date().toISOString()
      },
      { sessionId, agentId }
    );
  }

  /**
   * Publish a message lifecycle event and dispatch the corresponding hook.
   *
   * Enforces a 250 ms timeout budget so slow hooks do not block message flow.
   *
   * @param event - The lifecycle phase (`message_received`, `message_sending`, or `message_sent`)
   * @param sessionId - Session the message belongs to
   * @param agentId - Agent handling the message
   * @param message - The message content
   */
  async sendMessageLifecycle(
    event: 'message_received' | 'message_sending' | 'message_sent',
    sessionId: string,
    agentId: string,
    message: string
  ): Promise<void> {
    _ilogKernel(`sendMessageLifecycle event=${event} sessionId=${sessionId}`);
    this.events.publish(`lifecycle:${event}`, {
      sessionId,
      agentId,
      message
    });

    const hookCall = this.hooks.dispatchLifecycle(
      event,
      {
        sessionId,
        agentId,
        message
      },
      { sessionId, agentId }
    );

    const timeoutMs = 250;
    const timedOut = await Promise.race([
      hookCall.then(() => false).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs))
    ]);

    if (timedOut) {
      this.logger.warn('Message lifecycle hook dispatch exceeded budget; continuing', {
        event,
        sessionId,
        agentId,
        timeoutMs
      });
    }
  }
}
