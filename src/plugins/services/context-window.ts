/**
 * @module plugins/services/context-window
 *
 * Context window management utilities for conversation history.
 * Provides token-budget windowing, MIME type extraction, and
 * multi-part context summarization (ported from PicoClaw agent/loop.go).
 *
 * @see {@link windowByTokenBudget} — Keeps most-recent messages within a token budget
 * @see {@link maybeSummarize} — Triggers and performs conversation summarization
 * @see {@link SummarizationResult} — Summary output type
 */
import type { AgentMessage, LlmAdapter } from '@slashbot/core/agentic/llm/index.js';

// Re-export shared token estimation utilities from core
export { contentToText, estimateTokens, estimateMessageTokens } from '@slashbot/core/agentic/llm/helpers.js';

import { contentToText, estimateTokens, estimateMessageTokens } from '@slashbot/core/agentic/llm/helpers.js';

/**
 * Window messages by token budget, keeping the most recent messages
 * that fit within the budget.
 */
export function windowByTokenBudget(messages: AgentMessage[], budgetTokens: number): AgentMessage[] {
  const result: AgentMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i]);
    if (used + cost > budgetTokens && result.length > 0) break;
    result.unshift(messages[i]);
    used += cost;
  }
  return result;
}

export function mimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Context Summarization (ported from PicoClaw agent/loop.go)
// ---------------------------------------------------------------------------

export interface SummarizationResult {
  summary: string;
  keptMessages: AgentMessage[];
}

const SUMMARIZE_MESSAGE_THRESHOLD = 20;
const SUMMARIZE_TOKEN_RATIO = 0.75;
const KEEP_RECENT_MESSAGES = 4;
const MULTI_PART_THRESHOLD = 10;

const SUMMARIZE_PROMPT = `Summarize the following conversation concisely. Preserve key facts, decisions, action items, and context needed for continuity. Do NOT include greetings or filler. Output only the summary text.`;

const MERGE_PROMPT = `Merge these two conversation summaries into a single cohesive summary. Preserve all key facts, decisions, and action items. Remove redundancy. Output only the merged summary.`;

async function summarizeBatch(
  messages: AgentMessage[],
  llm: LlmAdapter,
  sessionId: string,
): Promise<string> {
  const conversation = messages
    .map((m) => `[${m.role}] ${contentToText(m.content)}`)
    .join('\n');

  const result = await llm.complete({
    sessionId,
    agentId: 'summarizer',
    messages: [
      { role: 'system', content: SUMMARIZE_PROMPT },
      { role: 'user', content: conversation },
    ],
    noTools: true,
  });

  return result.text.trim();
}

/**
 * Check if summarization is needed and perform it if so.
 *
 * Algorithm (from PicoClaw):
 * 1. Trigger when history.length > 20 OR estimateTokens(history) > 75% of contextBudget
 * 2. Keep last 4 messages for continuity
 * 3. Filter oversized messages (>50% of context window) — skip them
 * 4. Multi-part summarization when >10 messages to summarize:
 *    - Split into 2 halves, summarize each, merge with a third LLM call
 * 5. Single-batch summarization for <=10 messages
 * 6. Return summary + kept messages
 */
export async function maybeSummarize(
  history: AgentMessage[],
  contextBudget: number,
  existingSummary: string | undefined,
  llm: LlmAdapter,
  sessionId: string,
): Promise<SummarizationResult | null> {
  // Check trigger conditions
  const totalTokens = history.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const shouldSummarize =
    history.length > SUMMARIZE_MESSAGE_THRESHOLD ||
    totalTokens > contextBudget * SUMMARIZE_TOKEN_RATIO;

  if (!shouldSummarize) return null;

  // Keep the most recent messages for continuity
  const keptMessages = history.slice(-KEEP_RECENT_MESSAGES);
  const toSummarize = history.slice(0, -KEEP_RECENT_MESSAGES);

  if (toSummarize.length === 0) return null;

  // Filter out oversized messages (>50% of context)
  const maxMessageTokens = Math.floor(contextBudget * 0.5);
  const filteredMessages = toSummarize.filter(
    (m) => estimateMessageTokens(m) <= maxMessageTokens,
  );

  if (filteredMessages.length === 0) {
    // All messages were oversized; just return the kept tail
    return { summary: existingSummary ?? '', keptMessages };
  }

  // Prepend existing summary context if available
  const messagesWithContext: AgentMessage[] = existingSummary
    ? [{ role: 'system' as const, content: `Previous conversation summary:\n${existingSummary}` }, ...filteredMessages]
    : filteredMessages;

  let summary: string;

  if (messagesWithContext.length > MULTI_PART_THRESHOLD) {
    // Multi-part summarization: split in two halves, summarize each, merge
    const mid = Math.floor(messagesWithContext.length / 2);
    const firstHalf = messagesWithContext.slice(0, mid);
    const secondHalf = messagesWithContext.slice(mid);

    const [summary1, summary2] = await Promise.all([
      summarizeBatch(firstHalf, llm, sessionId),
      summarizeBatch(secondHalf, llm, sessionId),
    ]);

    const mergeResult = await llm.complete({
      sessionId,
      agentId: 'summarizer',
      messages: [
        { role: 'system', content: MERGE_PROMPT },
        { role: 'user', content: `Summary 1:\n${summary1}\n\nSummary 2:\n${summary2}` },
      ],
      noTools: true,
    });

    summary = mergeResult.text.trim();
  } else {
    // Single-batch summarization
    summary = await summarizeBatch(messagesWithContext, llm, sessionId);
  }

  return { summary, keptMessages };
}
