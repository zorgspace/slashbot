/**
 * @module kernel-services
 *
 * Registers well-known kernel services into the {@link ServiceRegistry}.
 * Extracted from the kernel constructor to keep the facade thin.
 */

import type {
  JsonValue,
  ToolCallContext,
  ToolResult,
  PathResolver
} from './contracts.js';
import type { ServiceRegistry } from './registries.js';
import type { EventBus } from './event-bus.js';
import type { PromptAssembler } from './prompt-assembler.js';
import type {
  ProviderRegistry,
  ChannelRegistry,
  ToolRegistry,
  CommandRegistry,
  StatusIndicatorRegistry
} from './registries.js';

/**
 * Dependencies required to wire up the kernel services.
 *
 * This is intentionally a plain object rather than the full kernel
 * so that the service module never imports the kernel class directly
 * (avoiding circular dependencies).
 */
export interface KernelServiceDeps {
  services: ServiceRegistry;
  providers: ProviderRegistry;
  channels: ChannelRegistry;
  tools: ToolRegistry;
  commands: CommandRegistry;
  statusIndicators: StatusIndicatorRegistry;
  events: EventBus;
  promptAssembler: PromptAssembler;
  config: unknown;
  workspaceRoot: string;
  paths: PathResolver;
  authRouter: unknown;
  logger: unknown;
  /** Bound references to kernel methods (avoids importing the class). */
  health: () => unknown;
  diagnosticsReport: () => unknown;
  runTool: (toolId: string, args: JsonValue, context?: ToolCallContext) => Promise<ToolResult>;
  assemblePrompt: () => Promise<string>;
  sendMessageLifecycle: (
    event: 'message_received' | 'message_sending' | 'message_sent',
    sessionId: string,
    agentId: string,
    message: string
  ) => Promise<void>;
  listLoadedPlugins: () => string[];
  /** The kernel instance itself (for the deprecated `kernel.instance` service). */
  kernelInstance: unknown;
}

/**
 * Register all well-known kernel services into the service registry.
 *
 * Must be called once during kernel construction, after all registries
 * and subsystems have been initialised.
 */
export function registerKernelServices(deps: KernelServiceDeps): void {
  const { services } = deps;

  services.register({
    id: 'kernel.health',
    pluginId: 'kernel',
    description: 'Kernel health accessor',
    implementation: () => deps.health()
  });
  services.register({
    id: 'kernel.diagnostics',
    pluginId: 'kernel',
    description: 'Kernel plugin diagnostics accessor',
    implementation: () => deps.diagnosticsReport()
  });
  services.register({
    id: 'kernel.providers',
    pluginId: 'kernel',
    description: 'Provider registry accessor',
    implementation: () => deps.providers.list()
  });
  services.register({
    id: 'kernel.providers.registry',
    pluginId: 'kernel',
    description: 'Provider registry object',
    implementation: deps.providers
  });
  services.register({
    id: 'kernel.channels',
    pluginId: 'kernel',
    description: 'Channel registry accessor',
    implementation: () => deps.channels.list()
  });
  services.register({
    id: 'kernel.config',
    pluginId: 'kernel',
    description: 'Runtime config accessor',
    implementation: deps.config
  });
  services.register({
    id: 'kernel.workspaceRoot',
    pluginId: 'kernel',
    description: 'Workspace root path',
    implementation: deps.workspaceRoot
  });
  services.register({
    id: 'kernel.authRouter',
    pluginId: 'kernel',
    description: 'Auth router accessor',
    implementation: deps.authRouter
  });
  services.register({
    id: 'kernel.logger',
    pluginId: 'kernel',
    description: 'Logger accessor',
    implementation: deps.logger
  });
  services.register({
    id: 'kernel.runTool',
    pluginId: 'kernel',
    description: 'Tool execution accessor',
    implementation: (toolId: string, args: JsonValue, context: ToolCallContext = {}) =>
      deps.runTool(toolId, args, context)
  });
  services.register({
    id: 'kernel.paths',
    pluginId: 'kernel',
    description: 'Path resolver for home and workspace directories',
    implementation: deps.paths
  });
  services.register({
    id: 'kernel.events',
    pluginId: 'kernel',
    description: 'Event bus for pub-sub',
    implementation: deps.events
  });
  services.register({
    id: 'kernel.assemblePrompt',
    pluginId: 'kernel',
    description: 'Assemble full system prompt from all contributors',
    implementation: () => deps.assemblePrompt()
  });
  services.register({
    id: 'kernel.sendMessageLifecycle',
    pluginId: 'kernel',
    description: 'Send message lifecycle events',
    implementation: (
      event: 'message_received' | 'message_sending' | 'message_sent',
      sessionId: string,
      agentId: string,
      message: string
    ) => deps.sendMessageLifecycle(event, sessionId, agentId, message)
  });
  services.register({
    id: 'kernel.tools.registry',
    pluginId: 'kernel',
    description: 'Tool registry for listing and getting tools',
    implementation: deps.tools
  });
  services.register({
    id: 'kernel.commands.registry',
    pluginId: 'kernel',
    description: 'Command registry for listing and getting commands',
    implementation: deps.commands
  });
  services.register({
    id: 'kernel.channels.registry',
    pluginId: 'kernel',
    description: 'Channel registry for getting channels by ID',
    implementation: deps.channels
  });
  services.register({
    id: 'kernel.statusIndicators.registry',
    pluginId: 'kernel',
    description: 'Status indicator registry for UI',
    implementation: deps.statusIndicators
  });
  services.register({
    id: 'kernel.loadedPlugins',
    pluginId: 'kernel',
    description: 'List loaded plugin IDs',
    implementation: () => deps.listLoadedPlugins()
  });
  // Deprecated: plugins should use specific services above instead
  services.register({
    id: 'kernel.instance',
    pluginId: 'kernel',
    description: 'Kernel instance reference (deprecated — use specific services)',
    implementation: deps.kernelInstance
  });
}
