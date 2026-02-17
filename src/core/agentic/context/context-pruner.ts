/**
 * @module context/context-pruner
 *
 * Two-tier pruning of old tool results to reduce token usage within the
 * context window. Applies soft-trim (head+tail snippets) when budget
 * usage exceeds the soft threshold, and hard-clear (placeholder replacement)
 * when it exceeds the hard threshold. Recent assistant messages are always
 * protected from pruning.
 *
 * @see {@link pruneContextMessages} — Main pruning function
 */
import type { AgentMessage } from '../llm/types.js';
import type { ContextPipelineConfig } from './types.js';
import { estimateTokens, estimateMessageTokens, contentToText } from '../llm/helpers.js';
import { resolveContextBudget } from '../llm/helpers.js';

/**
 * Prunes old tool results from messages using a two-tier strategy based
 * on context budget usage ratio.
 *
 * - Soft-trim (at softTrimThreshold): large tool results (> softTrimMinChars)
 *   are reduced to head + tail snippets.
 * - Hard-clear (at hardClearThreshold): old tool results are replaced with
 *   a placeholder message.
 *
 * The last `protectedRecentMessages` assistant messages are never pruned.
 *
 * @param messages - The conversation messages to prune
 * @param config - Pipeline configuration with pruning thresholds
 * @returns The pruned messages and whether any pruning was applied
 */
export function pruneContextMessages(
  messages: AgentMessage[],
  config: ContextPipelineConfig,
): { messages: AgentMessage[]; pruned: boolean } {
  const budget = resolveContextBudget(config.contextLimit, config.reserveTokens);
  const totalTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const usageRatio = totalTokens / budget;

  if (usageRatio < config.softTrimThreshold) {
    return { messages, pruned: false };
  }

  // Identify protected zone: last N assistant messages by index
  const protectedIndices = new Set<number>();
  let assistantCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      protectedIndices.add(i);
      assistantCount++;
      if (assistantCount >= config.protectedRecentMessages) break;
    }
  }

  const needsHardClear = usageRatio >= config.hardClearThreshold;
  let pruned = false;
  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Never prune system messages or protected recent messages
    if (msg.role === 'system' || protectedIndices.has(i)) {
      result.push(msg);
      continue;
    }

    const text = contentToText(msg.content);
    const isToolResult = msg.role === 'assistant' && isLikelyToolResult(text);

    if (!isToolResult) {
      result.push(msg);
      continue;
    }

    // Hard-clear: replace old tool results with placeholder
    if (needsHardClear) {
      result.push({ ...msg, content: '[Old tool result content cleared to save context]' });
      pruned = true;
      continue;
    }

    // Soft-trim: large tool results get head+tail
    if (text.length > config.softTrimMinChars) {
      const head = text.slice(0, config.softTrimKeepChars);
      const tail = text.slice(-config.softTrimKeepChars);
      const trimmedText = head + `\n\n[... ${text.length - config.softTrimKeepChars * 2} characters trimmed ...]\n\n` + tail;
      result.push({ ...msg, content: trimmedText });
      pruned = true;
    } else {
      result.push(msg);
    }
  }

  return { messages: result, pruned };
}

/**
 * Heuristic: a message is likely a tool result if it looks like structured
 * output (starts with common tool output patterns) or is very long.
 */
function isLikelyToolResult(text: string): boolean {
  if (text.length > 2000) return true;
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('ERROR [') ||
    trimmed.startsWith('OK (') ||
    trimmed.startsWith('```')
  );
}
