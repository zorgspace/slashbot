import type { AgentMessage } from '../../core/agentic/llm/index.js';

// Re-export shared token estimation utilities from core
export { contentToText, estimateTokens, estimateMessageTokens } from '../../core/agentic/llm/helpers.js';

import { estimateMessageTokens } from '../../core/agentic/llm/helpers.js';

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
