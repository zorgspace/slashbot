import type { AgentMessage } from '../llm/types.js';

/**
 * Limit conversation to the last N user turns, always keeping system messages.
 * A "turn" is counted per user message.
 */
export function limitHistoryTurns(messages: AgentMessage[], maxTurns: number): AgentMessage[] {
  if (maxTurns <= 0) return messages;

  const systemMessages: AgentMessage[] = [];
  const conversation: AgentMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      conversation.push(msg);
    }
  }

  // Count user messages from the end
  let userCount = 0;
  let cutIndex = 0;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === 'user') {
      userCount++;
      if (userCount > maxTurns) {
        cutIndex = i + 1;
        break;
      }
    }
  }

  return [...systemMessages, ...conversation.slice(cutIndex)];
}
