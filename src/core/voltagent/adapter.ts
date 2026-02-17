/**
 * @module voltagent/adapter
 *
 * VoltAgent-based LLM adapter that implements the {@link LlmAdapter} interface.
 * Drop-in replacement for KernelLlmAdapter. Uses VoltAgent Agent internally
 * to handle tool calling loops, while preserving the kernel's auth system,
 * event bus, and callback conventions.
 *
 * @see {@link VoltAgentAdapter} — Primary adapter class
 */
import { Agent } from '@voltagent/core';
import { randomUUID } from 'node:crypto';
import type { StructuredLogger } from '../kernel/contracts.js';
import type { ProviderRegistry } from '../kernel/registries.js';
import type { AuthProfileRouter } from '../providers/auth-router.js';
import type { SlashbotKernel } from '../kernel/kernel.js';
import type {
  LlmAdapter,
  LlmCompletionInput,
  StreamingCallback,
  TokenModeProxyAuthService,
  TokenModeProxyResolver,
  RichMessage,
} from '../agentic/llm/types.js';
import type { AgentLoopCallbacks, AgentLoopResult, AgentToolAction } from '../agentic/llm/types.js';
import { createResolvedModel } from './model-factory.js';
import { buildVoltAgentTools, type ToolBridgeToolMeta } from './tool-bridge.js';
import {
  isAbortError,
  isContextOverflowError,
  isRateLimitError,
} from '../agentic/llm/helpers.js';

/** No-op logger that silences VoltAgent's internal logging. */
const silentLogger: Record<string, unknown> = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

function truncateArgs(args: Record<string, unknown>, maxLen = 200): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const str = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    out[key] = str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
  }
  return out;
}

function deriveConnectorInfo(sessionId: string): { name: string; label: string } {
  if (sessionId === 'heartbeat') return { name: 'heartbeat', label: 'Heartbeat' };
  if (sessionId.startsWith('tg-')) return { name: 'telegram', label: 'Telegram' };
  if (sessionId.startsWith('dc-')) return { name: 'discord', label: 'Discord' };
  return { name: 'agent', label: 'Agent' };
}

/**
 * VoltAgent-based LLM adapter. Implements the same LlmAdapter interface as
 * KernelLlmAdapter, making it a drop-in replacement at all call sites.
 */
export class VoltAgentAdapter implements LlmAdapter {
  private readonly kernel: SlashbotKernel;
  private readonly authRouter: AuthProfileRouter;
  private readonly providers: ProviderRegistry;
  private readonly logger: StructuredLogger;
  private readonly tokenModeProxy?: TokenModeProxyResolver;

  constructor(
    authRouter: AuthProfileRouter,
    providers: ProviderRegistry,
    logger: StructuredLogger,
    kernel: SlashbotKernel,
    tokenModeProxy?: TokenModeProxyResolver,
  ) {
    this.kernel = kernel;
    this.authRouter = authRouter;
    this.providers = providers;
    this.logger = logger;
    this.tokenModeProxy = tokenModeProxy;
  }

  /**
   * Runs a full agentic completion with tool use. If callbacks are provided,
   * they are passed directly. Otherwise, auto-publishes connector:agentic
   * kernel events for TUI observation.
   */
  async complete(input: LlmCompletionInput, callbacks?: AgentLoopCallbacks): Promise<AgentLoopResult> {
    if (callbacks) {
      return this.runWithCallbacks(input, callbacks);
    }

    // No callbacks — auto-publish connector:agentic kernel events
    const { name: connector, label: displayLabel } = deriveConnectorInfo(input.sessionId);
    const contextKey = `${connector}:${input.sessionId}`;

    this.kernel.events.publish('connector:agentic', {
      connector, displayLabel, contextKey, status: 'started',
    });

    const autoCallbacks: AgentLoopCallbacks = {
      onTitle: (title) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'title', text: title,
        });
      },
      onThoughts: (text, stepIndex) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'thought', step: stepIndex, text,
        });
      },
      onToolStart: (action) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'tool_start',
          toolId: action.toolId, toolName: action.name,
          toolDescription: action.description, actionId: action.id,
          args: truncateArgs(action.args),
        });
      },
      onToolEnd: (action) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'tool_end',
          toolId: action.toolId, toolName: action.name,
          toolDescription: action.description, actionId: action.id,
          args: truncateArgs(action.args),
          ...(action.result ? { result: action.result } : {}),
          ...(action.error ? { error: action.error } : {}),
        });
      },
      onToolUserOutput: (toolId, content) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'tool_user_output',
          toolId, text: content,
        });
      },
      onSummary: (summary) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'summary', text: summary,
        });
      },
      onDone: (result) => {
        this.kernel.events.publish('connector:agentic', {
          connector, displayLabel, contextKey, status: 'done',
          steps: result.steps, toolCalls: result.toolCalls,
          finishReason: result.finishReason,
        });
      },
    };

    try {
      const result = await this.runWithCallbacks(input, autoCallbacks);
      this.kernel.events.publish('connector:agentic', {
        connector, displayLabel, contextKey, status: 'completed',
      });
      return result;
    } catch (err) {
      this.kernel.events.publish('connector:agentic', {
        connector, displayLabel, contextKey, status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Runs a streaming completion that pipes tokens through a callback.
   */
  async streamComplete(input: LlmCompletionInput, callback: StreamingCallback): Promise<void> {
    try {
      const model = await createResolvedModel({
        authRouter: this.authRouter,
        providers: this.providers,
        logger: this.logger,
        sessionId: input.sessionId,
        agentId: input.agentId,
        pinnedProviderId: input.pinnedProviderId,
        pinnedModelId: input.pinnedModelId,
        tokenModeProxy: this.tokenModeProxy,
      });

      if (!model) {
        callback.onError(new Error('No valid AI auth profile is configured.'));
        return;
      }

      // Extract system prompt from messages
      const { systemPrompt, userMessages } = this.extractPromptParts(input.messages);

      const agent = new Agent({
        name: input.agentId,
        instructions: systemPrompt,
        model: model as any,
        tools: [],
        maxSteps: 1,
        maxRetries: 0,
        memory: false,
        logger: silentLogger as any,
      });

      const result = await agent.streamText(userMessages, { maxRetries: 0 });

      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        callback.onToken(chunk);
      }

      callback.onComplete(fullText);
    } catch (error) {
      callback.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async runWithCallbacks(
    input: LlmCompletionInput,
    callbacks: AgentLoopCallbacks,
  ): Promise<AgentLoopResult> {
    let totalToolCalls = 0;
    const activeActionIds = new Map<string, string[]>();

    const toolCallbacks = {
      onToolStart: (toolId: string, args: Record<string, unknown>, meta?: ToolBridgeToolMeta) => {
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
        callbacks.onToolStart?.(action);
      },
      onToolEnd: (toolId: string, args: Record<string, unknown>, result: any, meta?: ToolBridgeToolMeta) => {
        totalToolCalls++;
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
        callbacks.onToolEnd?.(action);
      },
      onToolUserOutput: (toolId: string, content: string) => {
        callbacks.onToolUserOutput?.(toolId, content);
      },
    };

    const context = {
      sessionId: input.sessionId,
      agentId: input.agentId,
      requestId: randomUUID(),
      abortSignal: input.abortSignal,
    };

    try {
      const model = await createResolvedModel({
        authRouter: this.authRouter,
        providers: this.providers,
        logger: this.logger,
        sessionId: input.sessionId,
        agentId: input.agentId,
        pinnedProviderId: input.pinnedProviderId,
        pinnedModelId: input.pinnedModelId,
        tokenModeProxy: this.tokenModeProxy,
      });

      if (!model) {
        const text = 'No valid AI auth profile found. Configure a provider/API key, then try again.';
        callbacks.onSummary?.(text);
        const result: AgentLoopResult = { text, steps: 0, toolCalls: 0, finishReason: 'error' };
        callbacks.onDone?.(result);
        return result;
      }

      const tools = input.noTools ? [] : buildVoltAgentTools(
        this.kernel,
        context,
        toolCallbacks,
        undefined,
        { allowlist: input.toolAllowlist, denylist: input.toolDenylist },
      );

      const { systemPrompt, userMessages } = this.extractPromptParts(input.messages);

      const agent = new Agent({
        name: input.agentId,
        instructions: systemPrompt,
        model: model as any,
        tools,
        maxSteps: input.maxSteps ?? 25,
        maxRetries: 0,
        memory: false,
        logger: silentLogger as any,
      });

      const result = await agent.generateText(userMessages, {
        maxSteps: input.maxSteps ?? 25,
        maxRetries: 0,
        ...(input.maxTokens ? { maxOutputTokens: input.maxTokens } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      });

      const responseText = result.text || '(no response)';
      const stepCount = result.steps?.length ?? 1;
      const finishReason = result.finishReason ?? 'stop';

      // Extract title from first line
      const firstLine = responseText.split('\n')[0]?.trim();
      if (firstLine) {
        callbacks.onTitle?.(firstLine.slice(0, 100));
      }

      // Emit thoughts
      callbacks.onThoughts?.(responseText, stepCount);

      // Emit summary
      const summaryText = responseText.length > 280
        ? `${responseText.trim().slice(0, 260)}…`
        : responseText.trim();
      callbacks.onSummary?.(summaryText);

      // Build rich messages from steps
      const richMessages = this.extractRichMessages(result);

      const loopResult: AgentLoopResult = {
        text: responseText,
        steps: stepCount,
        toolCalls: totalToolCalls,
        finishReason,
        messages: richMessages.length > 0 ? richMessages : undefined,
      };

      callbacks.onDone?.(loopResult);
      return loopResult;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (isAbortError(error)) {
        this.logger.info('Agent loop aborted', { reason });
        const text = 'Operation cancelled.';
        const result: AgentLoopResult = { text, steps: 0, toolCalls: 0, finishReason: 'abort' };
        callbacks.onDone?.(result);
        return result;
      }

      this.logger.warn('Agent loop failed', { reason });

      let text: string;
      if (isContextOverflowError(reason)) {
        text = 'Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.';
      } else if (isRateLimitError(error)) {
        text = 'Rate limited by the provider. Wait a moment and try again.';
      } else {
        text = `LLM error: ${reason}`;
      }
      const result: AgentLoopResult = { text, steps: 0, toolCalls: totalToolCalls, finishReason: 'error' };
      callbacks.onDone?.(result);
      return result;
    }
  }

  /**
   * Extract system prompt and user messages from the input message array.
   */
  private extractPromptParts(messages: LlmCompletionInput['messages']): {
    systemPrompt: string;
    userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    let systemPrompt = '';
    const userMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((part) => part.type === 'text' ? part.text : '[Image attached]').join('\n');

      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + content;
      } else {
        userMessages.push({
          role: msg.role as 'user' | 'assistant',
          content,
        });
      }
    }

    return { systemPrompt, userMessages };
  }

  /**
   * Extract RichMessage array from VoltAgent generateText result steps.
   */
  private extractRichMessages(result: any): RichMessage[] {
    const richMessages: RichMessage[] = [];

    if (!result.steps || !Array.isArray(result.steps)) return richMessages;

    for (const step of result.steps) {
      // Assistant message with possible tool calls
      if (step.text || (step.toolCalls && step.toolCalls.length > 0)) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          richMessages.push({
            role: 'assistant',
            content: step.text ?? '',
            toolCalls: step.toolCalls.map((tc: any) => ({
              id: tc.toolCallId ?? '',
              name: tc.toolName ?? '',
              args: (tc.args ?? {}) as Record<string, unknown>,
            })),
          });
        } else if (step.text) {
          richMessages.push({
            role: 'assistant',
            content: step.text,
          });
        }
      }

      // Tool results
      if (step.toolResults && Array.isArray(step.toolResults)) {
        for (const tr of step.toolResults) {
          richMessages.push({
            role: 'tool',
            toolCallId: tr.toolCallId ?? '',
            content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result ?? ''),
          });
        }
      }
    }

    return richMessages;
  }
}
