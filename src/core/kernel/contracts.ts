import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodTypeAny } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type KernelHookName = 'startup' | 'input' | 'render' | 'tabs' | 'sidebar' | 'shutdown';

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

export type HookDomain = 'kernel' | 'lifecycle' | 'custom';

export interface HookExecutionContext {
  sessionId?: string;
  agentId?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
}

export interface HookRegistrationBase {
  id: string;
  pluginId: string;
  priority?: number;
  timeoutMs?: number;
  description?: string;
}

export interface KernelHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'kernel';
  event: KernelHookName;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

export interface LifecycleHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'lifecycle';
  event: LifecycleHookName;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

export interface CustomHookRegistration<T extends Record<string, unknown>> extends HookRegistrationBase {
  domain: 'custom';
  event: string;
  handler: (payload: Readonly<T>, context: HookExecutionContext) => Partial<T> | void | Promise<Partial<T> | void>;
}

export type HookRegistration<T extends Record<string, unknown>> =
  | KernelHookRegistration<T>
  | LifecycleHookRegistration<T>
  | CustomHookRegistration<T>;

export interface ConfigHookEntry {
  type: 'command';
  command: string;
  timeoutMs?: number;
}

export interface ConfigHookRule {
  matcher?: string;
  hooks: ConfigHookEntry[];
}

export type ConfigHookEventName =
  | 'PreToolUse' | 'PostToolUse'
  | 'PreCommand' | 'PostCommand'
  | 'MessageReceived' | 'MessageSending' | 'MessageSent'
  | 'SessionStart' | 'SessionEnd'
  | 'Startup' | 'Shutdown'
  | 'Notification' | 'Stop'
  | 'PreLlmCall' | 'PostLlmCall'
  | 'PrePromptAssemble' | 'PostPromptAssemble';

export type ConfigHookMap = Partial<Record<ConfigHookEventName, ConfigHookRule[]>>;

export interface HookFailure {
  pluginId: string;
  hookId: string;
  domain: HookDomain;
  event: string;
  elapsedMs: number;
  message: string;
  timedOut: boolean;
}

export interface HookDispatchReport<T extends Record<string, unknown>> {
  initialPayload: T;
  finalPayload: T;
  failures: HookFailure[];
}

export interface ToolCallContext {
  sessionId?: string;
  agentId?: string;
  requestId?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  output?: JsonValue;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
  metadata?: Record<string, JsonValue>;
}

export interface ToolDefinition<TArgs extends JsonValue = JsonValue> {
  id: string;
  title?: string;
  description: string;
  pluginId: string;
  execute: (args: TArgs, context: ToolCallContext) => Promise<ToolResult>;
  timeoutMs?: number;
  requiresApproval?: boolean;
  parameters?: ZodTypeAny;
}

export interface CommandExecutionContext {
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  nonInteractive: boolean;
  flags?: Record<string, string | boolean>;
  abortSignal?: AbortSignal;
}

export interface CommandDefinition {
  id: string;
  description: string;
  pluginId: string;
  subcommands?: string[];
  execute: (args: string[], context: CommandExecutionContext) => Promise<number>;
}

export type GatewayMethodHandler = (params: JsonValue, context: GatewayCallContext) => Promise<JsonValue>;

export interface GatewayMethodDefinition {
  id: string;
  pluginId: string;
  description: string;
  handler: GatewayMethodHandler;
}

export interface GatewayCallContext {
  sessionId?: string;
  agentId?: string;
  authToken: string;
  requestId: string;
}

export interface HttpRouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  pluginId: string;
  description: string;
  handler: (req: IncomingMessage, res: ServerResponse, ctx: GatewayCallContext) => Promise<void>;
}

export interface ServiceDefinition<TService> {
  id: string;
  pluginId: string;
  description: string;
  implementation: TService;
}

export interface ChannelDefinition {
  id: string;
  pluginId: string;
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
