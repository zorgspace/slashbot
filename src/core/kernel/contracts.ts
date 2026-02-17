/**
 * @module contracts
 *
 * Central type definitions and interfaces for the Slashbot kernel.
 * Every plugin, registry, and subsystem depends on the contracts defined here.
 *
 * @see {@link SlashbotPlugin} - Plugin interface that all plugins implement
 * @see {@link PluginRegistrationContext} - Context given to plugins during setup
 * @see {@link ToolDefinition} - Shape of a registered tool
 * @see {@link RuntimeConfig} - Resolved runtime configuration
 * @see {@link KernelServiceMap} - Type-safe service ID map
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodTypeAny } from 'zod';

/** Recursive JSON-compatible value type used throughout the kernel API. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Names of hooks dispatched in the `kernel` domain. */
export type KernelHookName = 'startup' | 'input' | 'render' | 'tabs' | 'sidebar' | 'shutdown';

/** Names of hooks dispatched in the `lifecycle` domain. */
export type LifecycleHookName =
  | 'before_agent_start'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop'
  | 'before_command'
  | 'after_command'
  | 'before_prompt_assemble'
  | 'after_prompt_assemble'
  | 'before_llm_call'
  | 'after_llm_call'
  | 'cli_init'
  | 'cli_exit';

/** Discriminator for the three hook dispatch domains. */
export type HookDomain = 'kernel' | 'lifecycle' | 'custom';

/** Ambient context passed to every hook handler invocation. */
export interface HookExecutionContext {
  /** Active session ID, if any. */
  sessionId?: string;
  /** Active agent ID, if any. */
  agentId?: string;
  /** Unique request ID for tracing. */
  requestId?: string;
  /** Signal that can abort long-running hooks. */
  abortSignal?: AbortSignal;
}

/** Common fields shared by all hook registration variants. */
export interface HookRegistrationBase {
  /** Unique hook identifier. */
  id: string;
  /** ID of the plugin that owns this hook. */
  pluginId: string;
  /** Execution priority (lower runs first, default 100). */
  priority?: number;
  /** Per-hook timeout override in milliseconds. */
  timeoutMs?: number;
  /** Human-readable description. */
  description?: string;
}

/** A hook registration bound to the `kernel` domain. */
export interface KernelHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'kernel';
  event: KernelHookName;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

/** A hook registration bound to the `lifecycle` domain. */
export interface LifecycleHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'lifecycle';
  event: LifecycleHookName;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

/** A hook registration bound to the `custom` (plugin-defined) domain. */
export interface CustomHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'custom';
  event: string;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

/** Union of all hook registration variants. */
export type HookRegistration<T extends Record<string, unknown>> =
  | KernelHookRegistration<T>
  | LifecycleHookRegistration<T>
  | CustomHookRegistration<T>;

/** A single hook entry in the config file (currently only `command` type). */
export interface ConfigHookEntry {
  /** Hook type discriminator. */
  type: 'command';
  /** Shell command to execute. */
  command: string;
  /** Optional timeout override in milliseconds. */
  timeoutMs?: number;
}

/** A config-driven hook rule with an optional matcher filter. */
export interface ConfigHookRule {
  /** Optional value to match against the hook's match field (e.g. a toolId). */
  matcher?: string;
  /** List of hook entries to execute when this rule matches. */
  hooks: ConfigHookEntry[];
}

/** Human-friendly event names used in config hook rules. */
export type ConfigHookEventName =
  | 'PreToolUse' | 'PostToolUse'
  | 'PreCommand' | 'PostCommand'
  | 'MessageReceived' | 'MessageSending' | 'MessageSent'
  | 'SessionStart' | 'SessionEnd'
  | 'Startup' | 'Shutdown'
  | 'Notification' | 'Stop'
  | 'PreLlmCall' | 'PostLlmCall'
  | 'PrePromptAssemble' | 'PostPromptAssemble';

/** Map from config event names to their hook rule arrays. */
export type ConfigHookMap = Partial<Record<ConfigHookEventName, ConfigHookRule[]>>;

/** Describes a single hook invocation that failed or timed out. */
export interface HookFailure {
  /** Plugin that owns the failed hook. */
  pluginId: string;
  /** Unique hook identifier. */
  hookId: string;
  /** Domain the hook was dispatched in. */
  domain: HookDomain;
  /** Event name that was dispatched. */
  event: string;
  /** Wall-clock time the hook consumed before failing. */
  elapsedMs: number;
  /** Error message or timeout description. */
  message: string;
  /** Whether the failure was caused by exceeding the timeout budget. */
  timedOut: boolean;
}

/** Report returned after dispatching a hook event to all listeners. */
export interface HookDispatchReport<T extends Record<string, unknown>> {
  /** The payload as it was before any hook modified it. */
  initialPayload: T;
  /** The payload after all successful hooks have been applied. */
  finalPayload: T;
  /** List of hooks that failed during dispatch. */
  failures: HookFailure[];
}

/** Ambient context passed to tool execute handlers. */
export interface ToolCallContext {
  /** Active session ID, if any. */
  sessionId?: string;
  /** Active agent ID, if any. */
  agentId?: string;
  /** Unique request ID for tracing. */
  requestId?: string;
  /** Per-call timeout override in milliseconds. */
  timeoutMs?: number;
  /** Signal that can abort long-running tool execution. */
  abortSignal?: AbortSignal;
}

/** Standardised result shape returned by all tool executions. */
export interface ToolResult {
  /** Whether the tool executed successfully. */
  ok: boolean;
  /** Primary output value visible to the LLM (unless overridden by `forLlm`). */
  output?: JsonValue;
  /** Error details when `ok` is false. */
  error?: {
    /** Machine-readable error code. */
    code: string;
    /** Human-readable error description. */
    message: string;
    /** Optional hint for the LLM on how to recover. */
    hint?: string;
  };
  /** Arbitrary metadata attached to the result (e.g. stderr, exit code). */
  metadata?: Record<string, JsonValue>;
  /** When set, the LLM sees this instead of `output`. */
  forLlm?: JsonValue;
  /** Sent directly to user (e.g. progress updates) without polluting LLM context. */
  forUser?: JsonValue;
  /** Suppress all user-facing output for this tool result. */
  silent?: boolean;
}

/** Tool result that is silent to the user but sends `forLlm` to the model. */
export function silentResult(forLlm: JsonValue): ToolResult {
  return { ok: true, forLlm, silent: true };
}

/** Tool result that only shows output to the user (LLM sees a minimal ack). */
export function userResult(content: JsonValue): ToolResult {
  return { ok: true, forUser: content, forLlm: 'OK' };
}

/** Tool result with separate payloads for LLM and user. */
export function dualResult(forLlm: JsonValue, forUser: JsonValue): ToolResult {
  return { ok: true, forLlm, forUser };
}

/** Full definition of a tool that can be registered with the kernel. */
export interface ToolDefinition<TArgs extends JsonValue = JsonValue> {
  /** Unique tool identifier (e.g. `web.fetch`). */
  id: string;
  /** Short human-readable title shown in the TUI. */
  title?: string;
  /** Description shown to the LLM and in help output. */
  description: string;
  /** ID of the plugin that owns this tool. */
  pluginId: string;
  /** Handler that performs the tool's work. */
  execute: (args: TArgs, context: ToolCallContext) => Promise<ToolResult>;
  /** Per-tool timeout override in milliseconds. */
  timeoutMs?: number;
  /** When true, the TUI prompts the user for approval before execution. */
  requiresApproval?: boolean;
  /** Optional Zod schema used for argument validation. */
  parameters?: ZodTypeAny;
}

/** Execution environment passed to CLI command handlers. */
export interface CommandExecutionContext {
  /** Current working directory. */
  cwd: string;
  /** Standard output stream. */
  stdout: NodeJS.WritableStream;
  /** Standard error stream. */
  stderr: NodeJS.WritableStream;
  /** Process environment variables. */
  env: NodeJS.ProcessEnv;
  /** Whether the command is running in non-interactive (headless) mode. */
  nonInteractive: boolean;
  /** Optional CLI flags parsed from the command line. */
  flags?: Record<string, string | boolean>;
  /** Signal that can abort long-running commands. */
  abortSignal?: AbortSignal;
}

/** Full definition of a CLI command that can be registered with the kernel. */
export interface CommandDefinition {
  /** Unique command identifier (e.g. `auth.login`). */
  id: string;
  /** Human-readable description shown in help output. */
  description: string;
  /** ID of the plugin that owns this command. */
  pluginId: string;
  /** Optional list of subcommand names for help display. */
  subcommands?: string[];
  /** Handler that performs the command's work, returning an exit code. */
  execute: (args: string[], context: CommandExecutionContext) => Promise<number>;
}

/** Handler function for a gateway JSON-RPC method. */
export type GatewayMethodHandler = (params: JsonValue, context: GatewayCallContext) => Promise<JsonValue>;

/** Definition of a gateway JSON-RPC method. */
export interface GatewayMethodDefinition {
  /** Unique method identifier. */
  id: string;
  /** ID of the plugin that owns this method. */
  pluginId: string;
  /** Human-readable description. */
  description: string;
  /** Handler that processes the RPC call. */
  handler: GatewayMethodHandler;
}

/** Context provided to gateway method and HTTP route handlers. */
export interface GatewayCallContext {
  /** Active session ID, if any. */
  sessionId?: string;
  /** Active agent ID, if any. */
  agentId?: string;
  /** Authentication token from the gateway request. */
  authToken: string;
  /** Unique request identifier for tracing. */
  requestId: string;
}

/** Definition of a custom HTTP route served by the gateway. */
export interface HttpRouteDefinition {
  /** HTTP method (verb). */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL path pattern (e.g. `/api/foo`). */
  path: string;
  /** ID of the plugin that owns this route. */
  pluginId: string;
  /** Human-readable description. */
  description: string;
  /** Handler that processes the HTTP request. */
  handler: (req: IncomingMessage, res: ServerResponse, ctx: GatewayCallContext) => Promise<void>;
}

/** Definition of a shared service that plugins can register and consume. */
export interface ServiceDefinition<TService> {
  /** Unique service identifier (e.g. `memory.store`). */
  id: string;
  /** ID of the plugin that owns this service. */
  pluginId: string;
  /** Human-readable description. */
  description: string;
  /** The service implementation (object, function, or value). */
  implementation: TService;
}

/** Definition of a messaging channel (e.g. Telegram, Discord, TUI). */
export interface ChannelDefinition {
  /** Unique channel identifier. */
  id: string;
  /** ID of the plugin that owns this channel. */
  pluginId: string;
  /** Human-readable description. */
  description: string;
  /** When true, this channel is a connector that owns user sessions. */
  connector?: boolean;
  /** Prefix used to match sessionIds to this connector (e.g. 'tg-' for telegram). */
  sessionPrefix?: string;
  send: (payload: JsonValue) => Promise<void>;
}

export interface PromptSectionContribution {
  id: string;
  pluginId: string;
  priority?: number;
  content: string;
}

export interface ContextContribution {
  id: string;
  pluginId: string;
  priority?: number;
  provide: () => Promise<string> | string;
}

export type IndicatorStatus = 'connected' | 'busy' | 'disconnected' | 'idle' | 'running' | 'error' | 'off';

export interface StatusIndicatorContribution {
  id: string;
  pluginId: string;
  label: string;
  kind: 'connector' | 'service';
  priority?: number;
  statusEvent: string;
  messageEvent?: string;
  showActivity?: boolean;
  connectorName?: string;
  getInitialStatus: () => IndicatorStatus;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  contextWindow: number;
  priority?: number;
  capabilities?: string[];
}

export type ProviderAuthMethod = 'oauth_pkce' | 'api_key' | 'setup_token' | 'claude_code_import';

export interface AuthProfile {
  profileId: string;
  providerId: string;
  label: string;
  method: ProviderAuthMethod;
  createdAt: string;
  updatedAt: string;
  data: Record<string, JsonValue>;
}

export interface AuthStartContext {
  agentId: string;
  profileLabel: string;
  nonInteractive: boolean;
  requestedScopes?: string[];
  redirectUri?: string;
}

export interface AuthStartResult {
  method: ProviderAuthMethod;
  authUrl?: string;
  instructions?: string;
  deviceCode?: string;
  state?: string;
  metadata?: Record<string, JsonValue>;
}

export interface AuthCompleteInput {
  state?: string;
  code?: string;
  verifier?: string;
  setupToken?: string;
  apiKey?: string;
  rawCredentials?: Record<string, JsonValue>;
}

export interface ProviderAuthHandler {
  method: ProviderAuthMethod;
  start: (context: AuthStartContext) => Promise<AuthStartResult>;
  complete: (context: AuthStartContext, input: AuthCompleteInput) => Promise<AuthProfile>;
  refresh?: (profile: AuthProfile) => Promise<AuthProfile>;
}

export interface ProviderDefinition {
  id: string;
  pluginId: string;
  displayName: string;
  models: ProviderModel[];
  authHandlers: ProviderAuthHandler[];
  preferredAuthOrder: ProviderAuthMethod[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string;
  description?: string;
  priority?: number;
  dependencies?: string[];
  peerDependencies?: string[];
  npmDependencies?: Record<string, string>;
  configSchema?: Record<string, unknown>;
}

export interface PluginLoadConfig {
  allow: string[];
  deny: string[];
  entries: Array<{ id: string; enabled?: boolean; config?: JsonValue }>;
  paths: string[];
}

export interface PluginDiagnostic {
  pluginId: string;
  status: 'loaded' | 'disabled' | 'failed' | 'skipped';
  reason?: string;
  sourcePath?: string;
}

export interface PathResolver {
  /** User-global root, e.g. ~/.slashbot */
  home(...segments: string[]): string;
  /** Workspace-local root, e.g. {cwd}/.slashbot */
  workspace(...segments: string[]): string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  details: Record<string, JsonValue>;
}

export interface StructuredLogger {
  debug: (message: string, fields?: Record<string, JsonValue>) => void;
  info: (message: string, fields?: Record<string, JsonValue>) => void;
  warn: (message: string, fields?: Record<string, JsonValue>) => void;
  error: (message: string, fields?: Record<string, JsonValue>) => void;
}

/**
 * Well-known kernel service IDs and their types.
 *
 * Use declaration merging to extend this map from other modules:
 * ```ts
 * declare module '../../core/kernel/contracts.js' {
 *   interface KernelServiceMap { 'my.service': MyType; }
 * }
 * ```
 */
export interface KernelServiceMap {
  'kernel.health': () => HealthStatus;
  'kernel.diagnostics': () => PluginDiagnostic[];
  'kernel.providers': () => ProviderDefinition[];
  'kernel.channels': () => ChannelDefinition[];
  'kernel.config': RuntimeConfig;
  'kernel.workspaceRoot': string;
  'kernel.logger': StructuredLogger;
  'kernel.paths': PathResolver;
  'kernel.assemblePrompt': () => Promise<string>;
  'kernel.loadedPlugins': () => string[];
  'kernel.runTool': (toolId: string, args: JsonValue, context?: ToolCallContext) => Promise<ToolResult>;
  'kernel.sendMessageLifecycle': (
    event: 'message_received' | 'message_sending' | 'message_sent',
    sessionId: string,
    agentId: string,
    message: string
  ) => Promise<void>;
}

export interface PluginRegistrationContext {
  registerTool: <TArgs extends JsonValue>(tool: ToolDefinition<TArgs>) => void;
  registerCommand: (command: CommandDefinition) => void;
  registerHook: <T extends Record<string, unknown>>(hook: HookRegistration<T>) => void;
  registerProvider: (provider: ProviderDefinition) => void;
  registerGatewayMethod: (method: GatewayMethodDefinition) => void;
  registerHttpRoute: (route: HttpRouteDefinition) => void;
  registerService: <TService>(service: ServiceDefinition<TService>) => void;
  /** Get a well-known kernel service by ID (type-safe). */
  getService<K extends keyof KernelServiceMap>(serviceId: K): KernelServiceMap[K] | undefined;
  /** Get a plugin-registered service by ID (generic fallback). */
  getService<TService>(serviceId: string): TService | undefined;
  registerChannel: (channel: ChannelDefinition) => void;
  contributePromptSection: (section: PromptSectionContribution) => void;
  contributeContextProvider: (provider: ContextContribution) => void;
  contributeStatusIndicator: (indicator: StatusIndicatorContribution) => (status: IndicatorStatus) => void;
  dispatchHook: <T extends Record<string, unknown>>(
    domain: HookDomain,
    event: string,
    payload: T,
    context?: HookExecutionContext
  ) => Promise<HookDispatchReport<T>>;
  logger: StructuredLogger;
}

export interface SlashbotPlugin {
  manifest: PluginManifest;
  setup: (context: PluginRegistrationContext) => Promise<void> | void;
  activate?: () => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
}

export type SlashClawPlugin = SlashbotPlugin;

export interface RuntimeFlags {
  cwd?: string;
  nonInteractive?: boolean;
  configPath?: string;
  gatewayToken?: string;
}

export interface RuntimeConfig {
  gateway: {
    host: string;
    port: number;
    authToken: string;
  };
  plugins: PluginLoadConfig;
  providers: {
    active?: { providerId: string; modelId: string; apiKey?: string };
  };
  hooks: {
    defaultTimeoutMs: number;
    rules?: ConfigHookMap;
  };
  commandSafety: {
    defaultTimeoutMs: number;
    riskyCommands: string[];
    requireExplicitApproval: boolean;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  skills: {
    allowBundled: boolean;
    bundledAllowlist?: string[];
    entries: Record<string, { enabled?: boolean; env?: Record<string, string> }>;
  };
}

export interface AuthResolution {
  providerId: string;
  modelId: string;
  profile: AuthProfile;
}

export interface ResolverFailureInput {
  sessionId: string;
  providerId: string;
  profileId: string;
}

export interface GatewayRequest {
  method: string;
  params: JsonValue;
  requestId: string;
}

export interface GatewayResponse {
  requestId: string;
  ok: boolean;
  result?: JsonValue;
  error?: {
    code: string;
    message: string;
  };
}
