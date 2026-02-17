/**
 * @module agent-loop
 *
 * Main agent execution loop that drives LLM conversations with tool use.
 * Handles the iterative cycle of sending messages to the LLM, processing
 * tool calls, collecting results, and supporting multi-provider failover
 * with rate-limit tracking and context overflow recovery.
 *
 * @see {@link runAgentLoop} — Primary entry point for running an agentic completion
 * @see {@link AgentLoopCallbacks} — Callback hooks for observing loop progress
 * @see {@link AgentLoopResult} — Return type with text, steps, and tool call count
 */
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { SlashbotKernel } from '../kernel/kernel.js';

function debugLog(msg: string): void {
  try { appendFileSync('/tmp/slashbot-debug.log', `[agent-loop ${new Date().toISOString()}] ${msg}\n`); } catch {}
}
import type { LlmCompletionInput, RunCompletionDeps, CompletionExecution, RichMessage } from './llm/types.js';
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
  estimateMessageTokens,
  extractToken,
  fallbackChatResponse,
  isAbortError,
  isContextOverflowError,
  isRateLimitError,
  mapMessages,
  RESERVE_TOKENS_DEFAULT,
  trimMessagesToFit,
} from './llm/helpers.js';
import { getProviderConfig, getProviderFactory } from './llm/provider-registry.js';
import { buildToolSet } from './tool-bridge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a single tool invocation during the agent loop, tracking its lifecycle. */
export interface AgentToolAction {
  /** Unique identifier for this action instance. */
  id: string;
  /** Human-readable display name of the tool. */
  name: string;
  /** Description of what the tool does. */
  description: string;
  /** Canonical tool identifier from the kernel registry. */
  toolId: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Current lifecycle status of the tool action. */
  status: 'running' | 'done' | 'error';
  /** Serialized result output when status is 'done'. */
  result?: string;
  /** Error message when status is 'error'. */
  error?: string;
}

/** Callbacks for observing the progress and events of an agent loop execution. */
export interface AgentLoopCallbacks {
  /** Called when a conversation title is derived from the first LLM response line. */
  onTitle?(title: string): void;
  /** Called with the LLM text output at each step of the loop. */
  onThoughts?(text: string, stepIndex: number): void;
  /** Called when a tool invocation begins. */
  onToolStart?(action: AgentToolAction): void;
  /** Called when a tool invocation completes (success or error). */
  onToolEnd?(action: AgentToolAction): void;
  /** Called when a tool produces user-facing output (dual-track forUser content). */
  onToolUserOutput?(toolId: string, content: string): void;
  /** Called with a compact summary of the final response text. */
  onSummary?(summary: string): void;
  /** Called when the agent loop finishes with the final result. */
  onDone?(result: AgentLoopResult): void;
}

/** Result returned by the agent loop upon completion. */
export interface AgentLoopResult {
  /** Final text response from the LLM. */
  text: string;
  /** Number of LLM generation steps performed. */
  steps: number;
  /** Total number of tool calls made across all steps. */
  toolCalls: number;
  /** Reason the loop terminated (e.g. 'stop', 'error', 'abort'). */
  finishReason: string;
  /** Full tool chain from the loop, for rich history persistence. */
  messages?: RichMessage[];
}

// ---------------------------------------------------------------------------
// AI SDK message → RichMessage normalizer
// ---------------------------------------------------------------------------

function normalizeAiSdkMessage(msg: Record<string, unknown>): RichMessage | null {
  const role = msg.role as string | undefined;

  if (role === 'assistant') {
    // Check for tool calls
    const toolCalls = msg.toolCalls as Array<{ toolCallId?: string; toolName?: string; args?: Record<string, unknown> }> | undefined;
    if (toolCalls && toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        toolCalls: toolCalls.map((tc) => ({
          id: tc.toolCallId ?? '',
          name: tc.toolName ?? '',
          args: (tc.args ?? {}) as Record<string, unknown>,
        })),
      };
    }
    return {
      role: 'assistant',
      content: typeof msg.content === 'string' ? msg.content : '',
    };
  }

  if (role === 'tool') {
    // AI SDK tool result messages have a toolCallId and content array
    const toolCallId = (msg.toolCallId as string)
      ?? (Array.isArray(msg.content) ? (msg.content[0] as Record<string, unknown>)?.toolCallId as string : undefined)
      ?? '';
    const content = Array.isArray(msg.content)
      ? (msg.content as Array<Record<string, unknown>>).map((p) => typeof p.result === 'string' ? p.result : JSON.stringify(p.result ?? '')).join('\n')
      : typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    return { role: 'tool', toolCallId, content };
  }

  return null;
}

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

/**
 * Runs the main agent loop: sends messages to an LLM, processes tool calls
 * iteratively, and returns the final result. Supports multi-provider failover,
 * rate-limit tracking, context window management, and abort signals.
 *
 * @param input - Completion input containing messages, session info, and options
 * @param deps - Runtime dependencies (auth router, providers, logger)
 * @param kernel - The Slashbot kernel providing tool definitions and execution
 * @param callbacks - Optional callbacks for observing loop progress
 * @returns The final agent loop result with text, step count, and tool call count
 */
export async function runAgentLoop(
  input: LlmCompletionInput,
  deps: RunCompletionDeps,
  kernel: SlashbotKernel,
  callbacks?: AgentLoopCallbacks,
): Promise<AgentLoopResult> {
  const config = getProviderConfig('_fallback_sentinel_');
  const timeoutMs = config.timeoutMs;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const onAbort = () => abortController.abort();
  if (input.abortSignal) {
    if (input.abortSignal.aborted) { abortController.abort(); }
    else { input.abortSignal.addEventListener('abort', onAbort, { once: true }); }
  }

  try {
    const messages = mapMessages(input.messages);

    // Build tool set from kernel (shared across attempts)
    const context = {
      sessionId: input.sessionId,
      agentId: input.agentId,
      requestId: randomUUID(),
      abortSignal: abortController.signal,
    };
    let totalToolCalls = 0;

    // Track action UUIDs so onToolEnd can reuse the same ID assigned at onToolStart.
    // Per-toolId FIFO stack handles sequential calls; parallel calls get first-in-first-out matching.
    const activeActionIds = new Map<string, string[]>();

    const tools = input.noTools ? {} : buildToolSet(kernel, context, {

      onToolStart: (toolId, args, meta) => {
        const actionId = randomUUID();
        const stack = activeActionIds.get(toolId) ?? [];
        stack.push(actionId);
        activeActionIds.set(toolId, stack);

        const action: AgentToolAction = {
          id: actionId,
          name: meta?.name ?? toolId,
          description: meta?.description ?? '',
          toolId,
          args,
          status: 'running',
        };
        debugLog(`onToolStart toolId=${toolId} actionId=${actionId}`);
        callbacks?.onToolStart?.(action);
      },
      onToolEnd: (toolId, args, result, meta) => {
        totalToolCalls++;

        // Reuse the UUID assigned at start (FIFO order).
        const stack = activeActionIds.get(toolId);
        const actionId = stack?.shift() ?? '';
        if (stack && stack.length === 0) activeActionIds.delete(toolId);

        const action: AgentToolAction = {
          id: actionId,
          name: meta?.name ?? toolId,
          description: meta?.description ?? '',
          toolId,
          args,
          status: result.ok ? 'done' : 'error',
          result: result.ok ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output)) : undefined,
          error: result.ok ? undefined : result.error?.message,
        };
        debugLog(`onToolEnd toolId=${toolId} actionId=${actionId} status=${action.status}`);
        callbacks?.onToolEnd?.(action);
      },
      onToolUserOutput: (toolId, content) => {
        callbacks?.onToolUserOutput?.(toolId, content);
      },
    }, undefined, { allowlist: input.toolAllowlist, denylist: input.toolDenylist });

    debugLog(`runAgentLoop: ${Object.keys(tools).length} tools available, noTools=${!!input.noTools}, session=${input.sessionId}`);

    // Resolve executions and run generateText with failover
    const executions = await resolveExecutions(input, deps);
    if (executions.length === 0) {
      const text = fallbackChatResponse();
      callbacks?.onSummary?.(text);
      callbacks?.onDone?.({ text, steps: 0, toolCalls: 0, finishReason: 'error' });
      return { text, steps: 0, toolCalls: 0, finishReason: 'error' };
    }

    let lastError: string | undefined;
    const rateLimitedProviders = new Set<string>();

    for (const execution of executions) {
      // Skip providers already rate-limited during this loop
      if (rateLimitedProviders.has(execution.providerId)) {
        deps.logger.info('Skipping rate-limited provider', {
          providerId: execution.providerId,
          modelId: execution.modelId,
        });
        continue;
      }

      const factory = getProviderFactory(execution.providerId);
      if (!factory) {
        lastError = `Provider unsupported: ${execution.providerId}`;
        continue;
      }

      const model = factory(execution) as Parameters<typeof generateText>[0]['model'];
      const providerConfig = getProviderConfig(execution.providerId);

      // Context management aligned with openclaw: context-window-guard (resolveContextWindowInfo, evaluateContextWindowGuard),
      // pi-settings reserveTokensFloor, trimMessagesToFit = budget (contextLimit - reserve), system cap 50% + recent conversation.
      // Resolve context limit: provider config or default (openclaw: resolveContextWindowInfo)
      const contextLimit = providerConfig.contextLimit ?? DEFAULT_CONTEXT_TOKENS;

      // Openclaw-style context window guard: block if too small, warn if below recommended
      if (contextLimit < CONTEXT_WINDOW_HARD_MIN_TOKENS) {
        deps.logger.warn('Skipping provider: context window below minimum', {
          providerId: execution.providerId,
          modelId: execution.modelId,
          contextLimit,
          minimum: CONTEXT_WINDOW_HARD_MIN_TOKENS,
        });
        lastError = `Context window too small (${contextLimit} < ${CONTEXT_WINDOW_HARD_MIN_TOKENS})`;
        continue;
      }
      if (contextLimit < CONTEXT_WINDOW_WARN_BELOW_TOKENS) {
        deps.logger.warn('Low context window', {
          providerId: execution.providerId,
          modelId: execution.modelId,
          contextLimit,
          recommendAbove: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
        });
      }

      const effectiveMessages = trimMessagesToFit(messages, contextLimit, RESERVE_TOKENS_DEFAULT);
      const inputTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
      const budget = Math.max(1000, contextLimit - RESERVE_TOKENS_DEFAULT);
      if (inputTokens > budget) {
        deps.logger.info('Context trimmed to fit model limit (openclaw-style budget)', {
          providerId: execution.providerId,
          modelId: execution.modelId,
          contextLimit,
          reserveTokens: RESERVE_TOKENS_DEFAULT,
          estimatedInputTokens: inputTokens,
        });
      }

      let titleSet = false;
      let stepCount = 0;
      let lastStepText = '';

      try {
        const hasTools = Object.keys(tools).length > 0;
        // Reasoning models (o3/o4, deepseek-reasoner, grok-*-reasoning, etc.) reject temperature
        const isReasoningModel = /\b(reasoning|reasoner)\b|^o[3-9](-|$)/.test(execution.modelId);
        const maxSteps = input.maxSteps ?? 25;
      

        // Manual tool loop: AI SDK v6 defaults to 1 step (stopWhen: stepCountIs(1)).
        // We loop ourselves so tool results are always fed back to the model.
        let loopMessages = [...effectiveMessages] as Array<Record<string, unknown>>;
        let finalText = '';
        let finalFinishReason = 'unknown';

        for (let step = 0; step < maxSteps; step++) {
          const result = await generateText({
            model,
            ...(isReasoningModel ? {} : { temperature: providerConfig.temperature }),
            maxOutputTokens: input.maxTokens ?? providerConfig.maxTokens,
            maxRetries: 0,
            messages: loopMessages as never,
            ...(hasTools ? { tools, toolChoice: 'auto' as const } : {}),
            abortSignal: abortController.signal,
          });

          stepCount++;
          finalFinishReason = result.finishReason ?? 'unknown';

          // Extract title from first text response
          if (!titleSet && result.text) {
            const firstLine = result.text.split('\n')[0]?.trim();
            if (firstLine) {
              callbacks?.onTitle?.(firstLine.slice(0, 100));
              titleSet = true;
            }
          }

          if (result.text) {
            lastStepText = result.text;
            callbacks?.onThoughts?.(result.text, stepCount);
          }

          // If the model didn't call tools, we're done
          if (result.finishReason !== 'tool-calls') {
            finalText = result.text;
            break;
          }

          // Append response messages (assistant tool calls + tool results) for next iteration
          const responseMessages = (result as unknown as { response: { messages: Array<Record<string, unknown>> } }).response?.messages;
          if (responseMessages && responseMessages.length > 0) {
            loopMessages = [...loopMessages, ...responseMessages];
          } else {
            // No response messages to feed back — stop to avoid infinite loop
            finalText = result.text;
            break;
          }
        }

        const responseText = finalText || lastStepText || '(no response)';

        // Emit a compact summary to downstream consumers to save tokens / space.
        const summaryText = responseText.length > 280
          ? `${responseText.trim().slice(0, 260)}…`
          : responseText.trim();
        callbacks?.onSummary?.(summaryText);

        // Extract rich messages from the loop (everything after initial effectiveMessages)
        const newMessages = loopMessages.slice(effectiveMessages.length) as Array<Record<string, unknown>>;
        const richMessages: RichMessage[] = [];
        for (const raw of newMessages) {
          const normalized = normalizeAiSdkMessage(raw);
          if (normalized) richMessages.push(normalized);
        }

        const loopResult: AgentLoopResult = {
          text: responseText,
          steps: stepCount,
          toolCalls: totalToolCalls,
          finishReason: finalFinishReason,
          messages: richMessages.length > 0 ? richMessages : undefined,
        };
        callbacks?.onDone?.(loopResult);

        return loopResult;
      } catch (completionError) {
        if (isAbortError(completionError) || abortController.signal.aborted) {
          throw completionError;
        }

        // Extract detailed error info from AI SDK errors
        if (completionError instanceof Error) {
          const err = completionError as Error & { statusCode?: number; responseBody?: string; data?: unknown };
          lastError = err.responseBody ?? err.message;
          if (err.data) {
            lastError = `${err.message} — ${JSON.stringify(err.data)}`;
          }
        } else {
          lastError = String(completionError);
        }

        // On rate limit, block the entire provider (org-level limit)
        if (isRateLimitError(completionError)) {
          rateLimitedProviders.add(execution.providerId);
          deps.authRouter.reportProviderRateLimit(input.sessionId, execution.providerId);
          deps.logger.warn('Provider rate-limited, skipping remaining attempts for this provider', {
            providerId: execution.providerId,
            modelId: execution.modelId,
          });
        }

        // Report failure so auth router deprioritises this profile
        if (execution.profileId) {
          deps.authRouter.reportFailure({
            sessionId: input.sessionId,
            providerId: execution.providerId,
            profileId: execution.profileId,
          });
        }

        deps.logger.warn('Agent loop attempt failed, trying next provider', {
          providerId: execution.providerId,
          modelId: execution.modelId,
          reason: lastError,
        });
      }
    }

    // All attempts exhausted — surface context overflow with a clear message (openclaw-style)
    deps.logger.warn('Agent loop failed, all providers exhausted', { lastError: lastError ?? 'unknown' });
    const contextOverflowText =
      'Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model. You can also reduce system prompt size in config.';
    const text = lastError && isContextOverflowError(lastError) ? contextOverflowText : fallbackChatResponse();
    callbacks?.onDone?.({ text, steps: 0, toolCalls: 0, finishReason: 'error' });
    return { text, steps: 0, toolCalls: 0, finishReason: 'error' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (isAbortError(error)) {
      deps.logger.info('Agent loop aborted', { reason });
      const text = 'Operation cancelled.';
      callbacks?.onDone?.({ text, steps: 0, toolCalls: 0, finishReason: 'abort' });
      return { text, steps: 0, toolCalls: 0, finishReason: 'abort' };
    }

    deps.logger.warn('Agent loop failed, fallback selected', { reason });
    const contextOverflowText =
      'Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model. You can also reduce system prompt size in config.';
    const text = isContextOverflowError(reason) ? contextOverflowText : fallbackChatResponse();
    callbacks?.onDone?.({ text, steps: 0, toolCalls: 0, finishReason: 'error' });
    return { text, steps: 0, toolCalls: 0, finishReason: 'error' };
  } finally {
    clearTimeout(timeout);
    input.abortSignal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Auth resolution — returns all candidate executions for failover
// ---------------------------------------------------------------------------

async function resolveExecutions(
  input: LlmCompletionInput,
  deps: RunCompletionDeps,
): Promise<CompletionExecution[]> {
  // Token-mode proxy path
  const tokenModeProxy = deps.resolveTokenModeProxy();
  const proxyProbe = tokenModeProxy
    ? await tokenModeProxy.resolveProxyRequest('')
    : null;

  if (proxyProbe?.enabled) {
    const baseUrl = proxyProbe.baseUrl?.trim();
    if (!baseUrl) return [];

    const modelId = deps.selectModelForProvider('xai') ?? 'grok-4-1';

    const proxyFetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const liveProxy = deps.resolveTokenModeProxy();
      if (!liveProxy) throw new Error('Token mode proxy unavailable');
      const resolvedProxy = await liveProxy.resolveProxyRequest(
        typeof init?.body === 'string' ? init.body : '',
      );
      if (!resolvedProxy.enabled) throw new Error(resolvedProxy.reason || 'Proxy unavailable');

      const mergedHeaders = new Headers(init?.headers as HeadersInit | undefined);
      mergedHeaders.delete('authorization');
      mergedHeaders.delete('api-key');
      mergedHeaders.delete('x-api-key');
      for (const [key, value] of Object.entries(resolvedProxy.headers ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
          mergedHeaders.set(key, String(value));
        }
      }
      return fetch(request, { ...(init ?? {}), headers: mergedHeaders });
    };

    return [{
      providerId: 'xai',
      modelId,
      token: 'token-mode-placeholder',
      baseUrl,
      customFetch: proxyFetch,
    }];
  }

  if (proxyProbe?.reason) return [];

  // Direct auth path — collect all candidate executions
  const MAX_ATTEMPTS = 3;
  const triedProfileIds: string[] = [];
  const executions: CompletionExecution[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resolved;
    try {
      resolved = await deps.authRouter.resolve({
        agentId: input.agentId,
        sessionId: input.sessionId,
        excludeProfileIds: triedProfileIds,
        pinnedProviderId: input.pinnedProviderId,
      });
    } catch (resolveError) {
      if (attempt === 1) throw resolveError;
      break;
    }

    triedProfileIds.push(resolved.profile.profileId);

    const provider = deps.providers.get(resolved.providerId);
    if (!provider) {
      deps.authRouter.reportFailure({
        sessionId: input.sessionId,
        providerId: resolved.providerId,
        profileId: resolved.profile.profileId,
      });
      continue;
    }

    const token = extractToken(resolved.profile);
    if (!token) {
      deps.authRouter.reportFailure({
        sessionId: input.sessionId,
        providerId: resolved.providerId,
        profileId: resolved.profile.profileId,
      });
      continue;
    }

    const resolvedModelId = input.pinnedModelId
      ?? deps.selectModelForProvider(provider.id, resolved.modelId)
      ?? resolved.modelId;

    executions.push({
      providerId: provider.id,
      modelId: resolvedModelId,
      token,
      profileId: resolved.profile.profileId,
    });
  }

  return executions;
}
