import type { StructuredLogger } from '../../kernel/contracts.js';
import type { ProviderRegistry } from '../../kernel/registries.js';
import type { AuthProfileRouter } from '../../providers/auth-router.js';
import type { SlashbotKernel } from '../../kernel/kernel.js';
import type {
  LlmAdapter,
  LlmCompletionInput,
  RunCompletionDeps,
  StreamingCallback,
  TokenModeProxyAuthService,
  TokenModeProxyResolver,
} from './types.js';
import type { AgentLoopCallbacks, AgentLoopResult } from '../agent-loop.js';
import { makeStreamCaller, runCompletion } from './completion-runner.js';
import { runAgentLoop } from '../agent-loop.js';

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

export class KernelLlmAdapter implements LlmAdapter {
  private readonly deps: RunCompletionDeps;
  private readonly kernel: SlashbotKernel;

  constructor(
    authRouter: AuthProfileRouter,
    providers: ProviderRegistry,
    logger: StructuredLogger,
    kernel: SlashbotKernel,
    tokenModeProxy?: TokenModeProxyResolver,
  ) {
    this.kernel = kernel;
    this.deps = {
      authRouter,
      providers,
      logger,
      resolveTokenModeProxy: () => this.resolveTokenModeProxy(tokenModeProxy),
      selectModelForProvider: (providerId, preferredModelId?) =>
        this.selectModelForProvider(providers, providerId, preferredModelId),
    };
  }

  async complete(input: LlmCompletionInput, callbacks?: AgentLoopCallbacks): Promise<AgentLoopResult> {
    if (callbacks) {
      return runAgentLoop(input, this.deps, this.kernel, callbacks);
    }

    // No callbacks provided — auto-publish connector:agentic kernel events
    // so the TUI can display activity for heartbeat, Discord, non-interactive, etc.
    const { name: connector, label: displayLabel } = deriveConnectorInfo(input.sessionId);
    const contextKey = `${connector}:${input.sessionId}`;

    this.kernel.events.publish('connector:agentic', {
      connector,
      displayLabel,
      contextKey,
      status: 'started',
    });

    const autoCallbacks: AgentLoopCallbacks = {
      onTitle: (title) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'title',
          text: title,
        });
      },
      onThoughts: (text, stepIndex) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'thought',
          step: stepIndex,
          text,
        });
      },
      onToolStart: (action) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'tool_start',
          toolId: action.toolId,
          toolName: action.name,
          toolDescription: action.description,
          actionId: action.id,
          args: truncateArgs(action.args),
        });
      },
      onToolEnd: (action) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'tool_end',
          toolId: action.toolId,
          toolName: action.name,
          toolDescription: action.description,
          actionId: action.id,
          args: truncateArgs(action.args),
          ...(action.result ? { result: action.result } : {}),
          ...(action.error ? { error: action.error } : {}),
        });
      },
      onToolUserOutput: (toolId, content) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'tool_user_output',
          toolId,
          text: content,
        });
      },
      onSummary: (summary) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'summary',
          text: summary,
        });
      },
      onDone: (result) => {
        this.kernel.events.publish('connector:agentic', {
          connector,
          displayLabel,
          contextKey,
          status: 'done',
          steps: result.steps,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
        });
      },
    };

    try {
      const result = await runAgentLoop(input, this.deps, this.kernel, autoCallbacks);
      this.kernel.events.publish('connector:agentic', {
        connector,
        displayLabel,
        contextKey,
        status: 'completed',
      });
      return result;
    } catch (err) {
      this.kernel.events.publish('connector:agentic', {
        connector,
        displayLabel,
        contextKey,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async streamComplete(input: LlmCompletionInput, callback: StreamingCallback): Promise<void> {
    try {
      const result = await runCompletion(input, this.deps, makeStreamCaller(callback));
      callback.onComplete(result);
    } catch (error) {
      callback.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private resolveTokenModeProxy(proxy?: TokenModeProxyResolver): TokenModeProxyAuthService | undefined {
    if (!proxy) return undefined;
    if (typeof proxy === 'function') return proxy();
    return proxy;
  }

  private selectModelForProvider(
    providers: ProviderRegistry,
    providerId: string,
    preferredModelId?: string,
  ): string | undefined {
    if (preferredModelId && preferredModelId.trim().length > 0) {
      return preferredModelId.trim();
    }

    const provider = providers.get(providerId);
    if (!provider || provider.models.length === 0) {
      return undefined;
    }

    return [...provider.models]
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .map((model) => model.id)
      .find((modelId) => modelId.length > 0);
  }
}
