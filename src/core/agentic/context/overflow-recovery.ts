/**
 * @module context/overflow-recovery
 *
 * Wraps LLM execution with escalating overflow recovery strategies.
 * When a context overflow error is detected, progressively more aggressive
 * trimming is applied: aggressive budget reduction, oversized content
 * truncation, and finally hard-clearing to only system + last 4 messages.
 *
 * @see {@link withOverflowRecovery} — Main wrapper function
 * @see {@link OverflowRecoveryCallbacks} — Optional retry observation callbacks
 */
import type { AgentMessage } from '../llm/types.js';
import type { ContextPipelineConfig } from './types.js';
import { isContextOverflowError } from '../llm/helpers.js';
import { prepareContext } from './pipeline.js';
import { OVERFLOW_MAX_RETRIES, OVERFLOW_AGGRESSIVE_TRIM_FACTOR } from './constants.js';

/** Callbacks for observing overflow recovery retry attempts. */
export interface OverflowRecoveryCallbacks {
  /** Called before each retry with the attempt number and strategy name. */
  onRetry?(attempt: number, strategy: string): void;
}

/**
 * Wraps an LLM execution function with escalating overflow recovery.
 * On context overflow errors, retries with increasingly aggressive trimming:
 *
 * - Attempt 0: normal call (caller already ran prepareContext)
 * - Attempt 1: aggressive trim (budget reduced by 25%)
 * - Attempt 2: truncate all large content (>8K chars) in messages
 * - Attempt 3: hard-clear to system messages + last 4 conversation messages
 *
 * @param messages - The prepared messages to send
 * @param config - Pipeline configuration for recovery strategies
 * @param executeFn - The LLM execution function to wrap
 * @param callbacks - Optional callbacks for observing retry attempts
 * @returns The result from the execution function
 * @throws Re-throws non-overflow errors or after all retries are exhausted
 */
export async function withOverflowRecovery<T>(
  messages: AgentMessage[],
  config: ContextPipelineConfig,
  executeFn: (messages: AgentMessage[]) => Promise<T>,
  callbacks?: OverflowRecoveryCallbacks,
): Promise<T> {
  let currentMessages = messages;

  for (let attempt = 0; attempt <= OVERFLOW_MAX_RETRIES; attempt++) {
    try {
      return await executeFn(currentMessages);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (!isContextOverflowError(errorMsg) || attempt >= OVERFLOW_MAX_RETRIES) {
        throw error;
      }

      const strategy = getStrategy(attempt + 1);
      callbacks?.onRetry?.(attempt + 1, strategy);
      currentMessages = applyRecoveryStrategy(currentMessages, config, attempt + 1);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Overflow recovery exhausted');
}

function getStrategy(attempt: number): string {
  switch (attempt) {
    case 1: return 'aggressive-trim';
    case 2: return 'truncate-oversized';
    case 3: return 'hard-clear-old';
    default: return 'unknown';
  }
}

function applyRecoveryStrategy(
  messages: AgentMessage[],
  config: ContextPipelineConfig,
  attempt: number,
): AgentMessage[] {
  switch (attempt) {
    case 1: {
      // Aggressive trim: reduce budget by 25%
      const tighterConfig: ContextPipelineConfig = {
        ...config,
        reserveTokens: config.reserveTokens + Math.floor(config.contextLimit * OVERFLOW_AGGRESSIVE_TRIM_FACTOR),
      };
      return prepareContext(messages, tighterConfig).messages;
    }
    case 2: {
      // Truncate oversized content in all messages
      return messages.map((msg) => {
        if (msg.role === 'system') return msg;
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text.length > 8000) {
          return { ...msg, content: text.slice(0, 4000) + '\n\n[... content truncated for overflow recovery ...]' };
        }
        return msg;
      });
    }
    case 3: {
      // Hard-clear: keep only system + last 4 messages
      const system = messages.filter((m) => m.role === 'system');
      const rest = messages.filter((m) => m.role !== 'system');
      return [...system, ...rest.slice(-4)];
    }
    default:
      return messages;
  }
}
