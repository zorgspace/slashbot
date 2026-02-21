/**
 * @module kernel
 *
 * Core orchestrator for the Slashbot plugin system. Manages plugin lifecycle,
 * tool/command/provider registries, hook dispatching, session management,
 * gateway lifecycle, and prompt assembly.
 *
 * The {@link SlashbotKernel} class is a thin delegating facade; heavy logic
 * lives in the extracted modules:
 *
 * - {@link ./kernel-boot}     — plugin discovery, sorting, registration, provider/catalog init
 * - {@link ./kernel-tools}    — tool & command execution, sessions, prompt, message lifecycle
 * - {@link ./kernel-services} — kernel service registration (DI wiring)
 *
 * @see {@link SlashbotKernel} - Main kernel class
 * @see {@link KernelCreateOptions} - Options for kernel instantiation
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

import type {
  CommandExecutionContext,
  HealthStatus,
  JsonValue,
  PathResolver,
  PluginDiagnostic,
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
import { AuthProfileStore } from '../auth/profile-store.js';
import { AuthProfileRouter } from '../providers/auth-router.js';
import { SlashbotGateway } from '../gateway/server.js';
import type { BundledPluginFactory, LoadedPlugin } from '../plugins/loader.js';
import type { DiscoveredPlugin } from '../plugins/discovery.js';

// Extracted modules
import { bootKernel } from './kernel-boot.js';
import {
  executeRunTool,
  executeRunCommand,
  executeAssemblePrompt,
  executeStartSession,
  executeEndSession,
  executeSendMessageLifecycle,
  computeHealth,
  deactivatePlugins,
} from './kernel-tools.js';
import { registerKernelServices } from './kernel-services.js';

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

    registerKernelServices({
      services: this.services,
      providers: this.providers,
      channels: this.channels,
      tools: this.tools,
      commands: this.commands,
      statusIndicators: this.statusIndicators,
      events: this.events,
      promptAssembler: this.promptAssembler,
      config: this.config,
      workspaceRoot: this.workspaceRoot,
      paths: this.paths,
      authRouter: this.authRouter,
      logger: this.logger,
      health: () => this.health(),
      diagnosticsReport: () => this.diagnosticsReport(),
      runTool: (toolId, args, context) => this.runTool(toolId, args, context),
      assemblePrompt: () => this.assemblePrompt(),
      sendMessageLifecycle: (event, sessionId, agentId, message) =>
        this.sendMessageLifecycle(event, sessionId, agentId, message),
      listLoadedPlugins: () => this.listLoadedPlugins(),
      kernelInstance: this,
    });
  }

  /**
   * Create and fully initialise a kernel instance.
   *
   * Loads runtime config, discovers and registers plugins (in dependency order),
   * applies provider overrides, and fetches the gateway model catalog.
   */
  static async create(options: KernelCreateOptions): Promise<SlashbotKernel> {
    const config = await loadRuntimeConfig(options.workspaceRoot, options.flags);
    const kernel = new SlashbotKernel(options.workspaceRoot, options.flags ?? {}, config);

    await bootKernel(
      {
        workspaceRoot: options.workspaceRoot,
        config,
        bundledPlugins: options.bundledPlugins ?? {},
        bundledDiscovered: options.bundledDiscovered ?? [],
      },
      {
        tools: kernel.tools,
        commands: kernel.commands,
        hooks: kernel.hooks,
        providers: kernel.providers,
        gatewayMethods: kernel.gatewayMethods,
        httpRoutes: kernel.httpRoutes,
        services: kernel.services,
        channels: kernel.channels,
        promptAssembler: kernel.promptAssembler,
        statusIndicators: kernel.statusIndicators,
        events: kernel.events,
        logger: kernel.logger,
      },
      {
        loadedPlugins: kernel.loadedPlugins,
        diagnostics: kernel.diagnostics,
      }
    );

    return kernel;
  }

  // -----------------------------------------------------------------------
  // Gateway lifecycle (keeps private gateway state)
  // -----------------------------------------------------------------------

  /** Start the HTTP/WebSocket gateway server. */
  async startGateway(): Promise<void> {
    if (this.gateway) return;

    const lifecycleReport = await this.hooks.dispatchLifecycle(
      'gateway_start',
      { gatewayHost: this.config.gateway.host, gatewayPort: this.config.gateway.port },
      {}
    );
    if (lifecycleReport.failures.length > 0) {
      this.logger.warn('gateway_start lifecycle had failures', { failures: lifecycleReport.failures.length });
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

  /** Stop the HTTP/WebSocket gateway server and clean up event forwarding. */
  async stopGateway(): Promise<void> {
    if (!this.gateway) return;

    this.gatewayEventUnsubscribe?.();
    this.gatewayEventUnsubscribe = undefined;
    await this.gateway.stop();
    this.gateway = undefined;

    const lifecycleReport = await this.hooks.dispatchLifecycle('gateway_stop', { stopped: true }, {});
    if (lifecycleReport.failures.length > 0) {
      this.logger.warn('gateway_stop lifecycle had failures', { failures: lifecycleReport.failures.length });
    }
  }

  // -----------------------------------------------------------------------
  // Kernel lifecycle
  // -----------------------------------------------------------------------

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
    await deactivatePlugins(this.loadedPlugins, this.logger);
  }

  // -----------------------------------------------------------------------
  // Delegating methods
  // -----------------------------------------------------------------------

  /** Execute a registered CLI command by ID. */
  async runCommand(commandId: string, args: string[], context: CommandExecutionContext): Promise<number> {
    return executeRunCommand(this, commandId, args, context);
  }

  /** Execute a registered tool by ID. */
  async runTool(toolId: string, args: JsonValue, context: ToolCallContext = {}): Promise<ToolResult> {
    return executeRunTool(this, toolId, args, context);
  }

  /** Return a snapshot of all plugin load diagnostics. */
  diagnosticsReport(): PluginDiagnostic[] {
    return [...this.diagnostics];
  }

  /** Compute the current kernel health status based on plugin diagnostics. */
  health(): HealthStatus {
    return computeHealth(this, this.diagnostics);
  }

  /** Return the IDs of all successfully loaded plugins. */
  listLoadedPlugins(): string[] {
    return this.loadedPlugins.map((item) => item.manifest.id);
  }

  /** Assemble the full system prompt. */
  async assemblePrompt(): Promise<string> {
    return executeAssemblePrompt(this);
  }

  /** Start a new session, persisting metadata and dispatching lifecycle hooks. */
  async startSession(sessionId: string, agentId: string): Promise<void> {
    return executeStartSession(this, sessionId, agentId);
  }

  /** End an active session, updating metadata and dispatching lifecycle hooks. */
  async endSession(sessionId: string, agentId: string): Promise<void> {
    return executeEndSession(this, sessionId, agentId);
  }

  /** Publish a message lifecycle event with a 250 ms hook timeout budget. */
  async sendMessageLifecycle(
    event: 'message_received' | 'message_sending' | 'message_sent',
    sessionId: string,
    agentId: string,
    message: string
  ): Promise<void> {
    return executeSendMessageLifecycle(this, event, sessionId, agentId, message);
  }
}
