/**
 * @module context/message-sanitizer
 *
 * Post-truncation message repair and provider-specific rule enforcement.
 * Removes orphaned or empty messages that may result from context trimming,
 * and enforces alternating turn rules for providers like Google Gemini.
 *
 * @see {@link sanitizeMessages} — Main entry point
 */
import type { AgentMessage } from '../llm/types.js';

/**
 * Repairs messages after truncation and enforces provider-specific rules.
 * Removes orphaned/empty messages and merges consecutive same-role messages
 * for providers that require alternating turns (e.g. Google Gemini).
 *
 * @param messages - Messages to sanitize (typically after trimming/pruning)
 * @param providerId - Optional provider ID for provider-specific rules
 * @returns Sanitized message array safe for API submission
 */
export function sanitizeMessages(
  messages: AgentMessage[],
  providerId?: string,
): AgentMessage[] {
  let result = removeOrphanedToolMessages(messages);

  if (providerId === 'google') {
    result = enforceAlternatingTurns(result);
  }

  return result;
}

/**
 * Remove assistant messages that reference tool calls whose results are missing
 * (or vice versa). After truncation, one side of a tool pair may be gone.
 *
 * Uses content heuristics since our AgentMessage type is string-based —
 * actual AI SDK tool_call/tool_result pairs would show up as structured content
 * that gets stringified.
 */
function removeOrphanedToolMessages(messages: AgentMessage[]): AgentMessage[] {
  // With the current string-based AgentMessage format, tool calls/results
  // are handled by the AI SDK internally. We only need to ensure that
  // consecutive assistant messages without user messages between them
  // don't create invalid state.
  return messages.filter((msg, i) => {
    // Remove empty-content messages that could result from hard-clearing
    if (msg.role !== 'system' && getContentLength(msg.content) === 0) {
      return false;
    }
    return true;
  });
}

/**
 * Gemini requires strictly alternating user/assistant turns.
 * Merge consecutive same-role messages by joining their content.
 */
function enforceAlternatingTurns(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    const prev = result[result.length - 1];

    if (prev && prev.role === msg.role && msg.role !== 'system') {
      // Merge content
      const prevText = typeof prev.content === 'string' ? prev.content : contentPartsToString(prev.content);
      const currText = typeof msg.content === 'string' ? msg.content : contentPartsToString(msg.content);
      result[result.length - 1] = { ...prev, content: prevText + '\n\n' + currText };
    } else {
      result.push(msg);
    }
  }

  return result;
}

function contentPartsToString(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : '[Image attached]'))
    .join('\n');
}

function getContentLength(content: AgentMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 16), 0);
}
