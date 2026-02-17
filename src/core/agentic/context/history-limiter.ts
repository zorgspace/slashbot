/**
 * @module context/history-limiter
 *
 * Limits conversation history to the most recent N user turns while
 * always preserving system messages. Used as the first stage of the
 * context preparation pipeline.
 *
 * @see {@link limitHistoryTurns} — Main entry point
 */
import type { AgentMessage } from '../llm/types.js';

/**
 * Limits conversation to the last N user turns, always keeping system messages.
 * A "turn" is counted per user message. All messages between kept user messages
 * (including assistant responses) are preserved.
 *
 * @param messages - The full conversation message array
 * @param maxTurns - Maximum number of user turns to retain (0 = unlimited)
 * @returns Messages trimmed to the specified turn count
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
