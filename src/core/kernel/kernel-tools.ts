/**
 * @module kernel-tools
 *
 * Tool execution, command execution, session management, prompt assembly,
 * and message lifecycle logic extracted from the kernel.
 *
 * All functions accept a dependency object so they never import the
 * kernel class directly (avoiding circular dependencies).
 */

import { randomUUID } from 'node:crypto';
import { promises as fs, appendFileSync } from 'node:fs';
import type {
  CommandExecutionContext,
  HealthStatus,
  JsonValue,
  PathResolver,
  PluginDiagnostic,
  StructuredLogger,
  ToolCallContext,
  ToolResult
} from './contracts.js';
import type { EventBus } from './event-bus.js';
import type { HookDispatcher } from './hook-dispatcher.js';
import type { PromptAssembler } from './prompt-assembler.js';
import type {
  CommandRegistry,
  GatewayMethodRegistry,
  ProviderRegistry,
  ToolRegistry
} from './registries.js';
import type { LoadedPlugin } from '../plugins/loader.js';

function _ilogKernel(msg: string): void {
  try { appendFileSync('/tmp/slashbot-ilog.log', `[kernel ${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ---------------------------------------------------------------------------
// Shared dependency interface
// ---------------------------------------------------------------------------

/**
 * Dependencies required by tool/command execution and operational helpers.
 *
 * A plain object so this module never imports the kernel class directly.
 */
export interface ToolExecDeps {
  tools: ToolRegistry;
  commands: CommandRegistry;
  providers: ProviderRegistry;
  gatewayMethods: GatewayMethodRegistry;
  hooks: HookDispatcher;
  events: EventBus;
  promptAssembler: PromptAssembler;
  paths: PathResolver;
  logger: StructuredLogger;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Execute a registered tool by ID.
 *
 * Dispatches `before_tool_call`, `after_tool_call`, and `tool_result_persist`
 * lifecycle hooks and publishes a `tool:result` event.
 */
export async function executeRunTool(
  deps: ToolExecDeps,
  toolId: string,
  args: JsonValue,
  context: ToolCallContext = {}
): Promise<ToolResult> {
  const tool = deps.tools.get(toolId);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${toolId}`
      }
    };
  }

  const before = await deps.hooks.dispatchLifecycle(
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

  await deps.hooks.dispatchLifecycle(
    'after_tool_call',
    {
      toolId,
      ok: result.ok,
      output: result.output ?? null,
      error: result.error?.message ?? null
    },
    context
  );

  deps.events.publish('tool:result', {
    toolId,
    args: effectiveArgs as Record<string, JsonValue>,
    sessionId: context.sessionId ?? '',
    ok: result.ok,
    output: result.output ?? null,
    error: result.error?.message ?? null,
  });

  await deps.hooks.dispatchLifecycle(
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

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Execute a registered CLI command by ID.
 *
 * Dispatches `before_command` / `after_command` lifecycle hooks around execution.
 */
export async function executeRunCommand(
  deps: ToolExecDeps,
  commandId: string,
  args: string[],
  context: CommandExecutionContext
): Promise<number> {
  const command = deps.commands.get(commandId);
  if (!command) {
    context.stderr.write(`Unknown command: ${commandId}\n`);
    return 1;
  }

  await deps.hooks.dispatchLifecycle(
    'before_command',
    { commandId, args },
    {}
  );

  const exitCode = await command.execute(args, context);

  await deps.hooks.dispatchLifecycle(
    'after_command',
    { commandId, exitCode },
    {}
  );

  return exitCode;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the full system prompt from all registered sections and context providers.
 * Dispatches `before_prompt_assemble` / `after_prompt_assemble` lifecycle hooks.
 */
export async function executeAssemblePrompt(deps: ToolExecDeps): Promise<string> {
  await deps.hooks.dispatchLifecycle('before_prompt_assemble', {}, {});

  const result = await deps.promptAssembler.assemble();

  await deps.hooks.dispatchLifecycle('after_prompt_assemble', { prompt: result }, {});

  return result;
}

// ---------------------------------------------------------------------------
// Health & diagnostics
// ---------------------------------------------------------------------------

/**
 * Compute the current kernel health status based on plugin diagnostics.
 */
export function computeHealth(deps: ToolExecDeps, diagnostics: readonly PluginDiagnostic[]): HealthStatus {
  const failed = diagnostics.filter((item) => item.status === 'failed').length;
  const status: HealthStatus['status'] = failed > 0 ? 'degraded' : 'ok';

  return {
    status,
    details: {
      pluginsLoaded: diagnostics.filter((item) => item.status === 'loaded').length,
      pluginsFailed: failed,
      commandCount: deps.commands.list().length,
      toolCount: deps.tools.list().length,
      providerCount: deps.providers.list().length,
      gatewayMethodCount: deps.gatewayMethods.list().length
    }
  };
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Start a new session, persisting metadata to disk and dispatching lifecycle hooks.
 */
export async function executeStartSession(
  deps: ToolExecDeps,
  sessionId: string,
  agentId: string
): Promise<void> {
  const sessionPath = deps.paths.home('agents', agentId, 'sessions', `${sessionId}.json`);
  await fs.mkdir(deps.paths.home('agents', agentId, 'sessions'), { recursive: true });
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

  deps.events.publish('lifecycle:session_start', {
    sessionId,
    agentId,
  });

  await deps.hooks.dispatchLifecycle(
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
 */
export async function executeEndSession(
  deps: ToolExecDeps,
  sessionId: string,
  agentId: string
): Promise<void> {
  const sessionPath = deps.paths.home('agents', agentId, 'sessions', `${sessionId}.json`);
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

  deps.events.publish('lifecycle:session_end', {
    sessionId,
    agentId,
  });

  await deps.hooks.dispatchLifecycle(
    'session_end',
    {
      sessionId,
      agentId,
      endedAt: new Date().toISOString()
    },
    { sessionId, agentId }
  );
}

// ---------------------------------------------------------------------------
// Message lifecycle
// ---------------------------------------------------------------------------

/**
 * Publish a message lifecycle event and dispatch the corresponding hook.
 *
 * Enforces a 250 ms timeout budget so slow hooks do not block message flow.
 */
export async function executeSendMessageLifecycle(
  deps: ToolExecDeps,
  event: 'message_received' | 'message_sending' | 'message_sent',
  sessionId: string,
  agentId: string,
  message: string
): Promise<void> {
  _ilogKernel(`sendMessageLifecycle event=${event} sessionId=${sessionId}`);
  deps.events.publish(`lifecycle:${event}`, {
    sessionId,
    agentId,
    message
  });

  const hookCall = deps.hooks.dispatchLifecycle(
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
    deps.logger.warn('Message lifecycle hook dispatch exceeded budget; continuing', {
      event,
      sessionId,
      agentId,
      timeoutMs
    });
  }
}

// ---------------------------------------------------------------------------
// Plugin shutdown
// ---------------------------------------------------------------------------

/**
 * Deactivate all loaded plugins, logging any failures.
 */
export async function deactivatePlugins(
  loadedPlugins: readonly LoadedPlugin[],
  logger: StructuredLogger
): Promise<void> {
  for (const plugin of loadedPlugins) {
    try {
      await plugin.instance.deactivate?.();
    } catch (error) {
      logger.warn('Plugin deactivation failed', {
        pluginId: plugin.manifest.id,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
