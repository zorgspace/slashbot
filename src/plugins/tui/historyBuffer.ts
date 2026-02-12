import type { StyledText } from '@opentui/core';

export type TabBufferAction =
  | { type: 'append'; content: string }
  | { type: 'appendStyled'; content: StyledText | string }
  | { type: 'appendUserMessage'; content: string }
  | { type: 'appendAssistantMessage'; content: StyledText | string }
  | { type: 'appendAssistantMarkdown'; text: string }
  | { type: 'upsertAssistantMarkdownBlock'; key: string; text: string }
  | { type: 'removeAssistantMarkdownBlock'; key: string }
  | { type: 'addCodeBlock'; content: string; filetype?: string }
  | { type: 'addDiffBlock'; diff: string; filetype?: string }
  | { type: 'responseStream'; content: string };

export const MAX_TAB_BUFFER_ACTIONS = 400;

export function hasBufferedHistory(actions?: TabBufferAction[]): boolean {
  return !!actions && actions.length > 0;
}

export function appendTabBufferAction(
  actions: TabBufferAction[],
  action: TabBufferAction,
  maxActions = MAX_TAB_BUFFER_ACTIONS,
): TabBufferAction[] {
  const next = [...actions, action];
  return pruneTabBuffer(next, maxActions);
}

export function startResponseStream(
  actions: TabBufferAction[],
  maxActions = MAX_TAB_BUFFER_ACTIONS,
): TabBufferAction[] {
  const next = [...actions, { type: 'responseStream', content: '' } satisfies TabBufferAction];
  return pruneTabBuffer(next, maxActions);
}

export function appendResponseStreamChunk(
  actions: TabBufferAction[],
  chunk: string,
  maxActions = MAX_TAB_BUFFER_ACTIONS,
): TabBufferAction[] {
  if (!chunk) {
    return actions;
  }

  const next = [...actions];
  const last = next[next.length - 1];
  if (last && last.type === 'responseStream') {
    next[next.length - 1] = {
      type: 'responseStream',
      content: `${last.content}${chunk}`,
    };
    return pruneTabBuffer(next, maxActions);
  }

  next.push({ type: 'responseStream', content: chunk });
  return pruneTabBuffer(next, maxActions);
}

export function pruneTabBuffer(
  actions: TabBufferAction[],
  maxActions = MAX_TAB_BUFFER_ACTIONS,
): TabBufferAction[] {
  if (actions.length <= maxActions) {
    return actions;
  }
  return actions.slice(actions.length - maxActions);
}
