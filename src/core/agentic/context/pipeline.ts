/**
 * @module context/pipeline
 *
 * Unified context preparation pipeline that processes messages through
 * four sequential stages before they are sent to the LLM: history turn
 * limiting, context pruning (soft-trim/hard-clear), token budget trimming,
 * and message sanitization for provider compatibility.
 *
 * @see {@link prepareContext} — Main entry point for the pipeline
 */
import type { AgentMessage } from '../llm/types.js';
import type { ContextPipelineConfig, ContextPipelineResult } from './types.js';
import { estimateMessageTokens, trimMessagesToFit } from '../llm/helpers.js';
import { limitHistoryTurns } from './history-limiter.js';
import { pruneContextMessages } from './context-pruner.js';
import { sanitizeMessages } from './message-sanitizer.js';

/**
 * Runs the unified context preparation pipeline on a message array.
 *
 * Flow:
 *   1. limitHistoryTurns (if maxHistoryTurns > 0)
 *   2. pruneContextMessages (soft-trim / hard-clear old tool results)
 *   3. trimMessagesToFit (system 50% cap + recent conversation backfill)
 *   4. sanitizeMessages (repair orphaned tool pairs, provider rules)
 *
 * @param messages - The raw conversation messages to prepare
 * @param config - Pipeline configuration controlling each stage
 * @returns The processed messages with metadata (trimmed, pruned, token estimate)
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
