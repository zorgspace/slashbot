import type { AgentMessage } from '../llm/types.js';
import type { ContextPipelineConfig, ContextPipelineResult } from './types.js';
import { estimateMessageTokens, trimMessagesToFit } from '../llm/helpers.js';
import { limitHistoryTurns } from './history-limiter.js';
import { pruneContextMessages } from './context-pruner.js';
import { sanitizeMessages } from './message-sanitizer.js';

/**
 * Unified context preparation pipeline.
 *
 * Flow:
 *   1. limitHistoryTurns (if maxHistoryTurns > 0)
 *   2. pruneContextMessages (soft-trim / hard-clear old tool results)
 *   3. trimMessagesToFit (system 50% cap + recent conversation backfill)
 *   4. sanitizeMessages (repair orphaned tool pairs, provider rules)
 */
export function prepareContext(
  messages: AgentMessage[],
  config: ContextPipelineConfig,
): ContextPipelineResult {
  // Step 1: limit history turns
  let current = config.maxHistoryTurns > 0
    ? limitHistoryTurns(messages, config.maxHistoryTurns)
    : messages;

  // Step 2: prune old tool results
  const pruneResult = pruneContextMessages(current, config);
  current = pruneResult.messages;

  // Step 3: trim to fit token budget
  const beforeTrim = current.length;
  current = trimMessagesToFit(current, config.contextLimit, config.reserveTokens);
  const trimmed = current.length < beforeTrim;

  // Step 4: sanitize messages
  current = sanitizeMessages(current, config.providerId);

  const estimatedTokens = current.reduce((s, m) => s + estimateMessageTokens(m), 0);

  return {
    messages: current,
    trimmed,
    pruned: pruneResult.pruned,
    estimatedTokens,
  };
}
