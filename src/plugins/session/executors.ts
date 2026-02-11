/**
 * Session action executors
 */

import type { ActionHandlers, ActionResult } from '../../core/actions/types';
import { display, formatToolAction } from '../../core/ui';

type SessionsListAction = { type: 'sessions-list' };
type SessionsHistoryAction = { type: 'sessions-history'; sessionId: string; limit?: number };
type SessionsSendAction = { type: 'sessions-send'; sessionId: string; message: string; run?: boolean };
type SessionsUsageAction = { type: 'sessions-usage' };
type SessionsCompactionAction = { type: 'sessions-compaction' };

export async function executeSessionsList(
  _action: SessionsListAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsList) return null;
  const rows = await handlers.onSessionsList();
  const list = Array.isArray(rows) ? rows : [];
  display.appendAssistantMessage(
    formatToolAction('SessionsList', `${list.length} session${list.length === 1 ? '' : 's'}`, {
      success: true,
    }),
  );
  return {
    action: 'SessionsList',
    success: true,
    result:
      list.length === 0
        ? 'No sessions'
        : list
            .map(
              (s: any) =>
                `${s.id} | messages=${s.messageCount ?? 0} | lastRole=${s.lastRole ?? 'n/a'} | preview=${(s.preview || '').replace(/\n/g, ' ')}`,
            )
            .join('\n'),
  };
}

export async function executeSessionsHistory(
  action: SessionsHistoryAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsHistory) return null;
  const history = await handlers.onSessionsHistory(action.sessionId, action.limit);
  const messages = Array.isArray(history) ? history : [];
  display.appendAssistantMessage(
    formatToolAction('SessionsHistory', action.sessionId, {
      success: true,
      summary: `${messages.length} messages`,
    }),
  );
  return {
    action: `SessionsHistory: ${action.sessionId}`,
    success: true,
    result:
      messages.length === 0
        ? 'No messages'
        : messages
            .map((m: any) => {
              const content =
                typeof m.content === 'string'
                  ? m.content
                  : Array.isArray(m.content)
                    ? (m.content.find((p: any) => p.type === 'text')?.text ?? '[multimodal]')
                    : '';
              return `${m.role}: ${String(content).slice(0, 500)}`;
            })
            .join('\n\n'),
  };
}

export async function executeSessionsSend(
  action: SessionsSendAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsSend) return null;
  const res = await handlers.onSessionsSend(action.sessionId, action.message, action.run ?? false);
  display.appendAssistantMessage(
    formatToolAction('SessionsSend', action.sessionId, {
      success: true,
      summary: action.run ? 'queued + executed' : 'queued',
    }),
  );
  return {
    action: `SessionsSend: ${action.sessionId}`,
    success: true,
    result: res?.response ? `Delivered\nResponse: ${res.response}` : 'Delivered',
  };
}

export async function executeSessionsUsage(
  _action: SessionsUsageAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsUsage) return null;
  const rows = await handlers.onSessionsUsage();
  const list = Array.isArray(rows) ? rows : [];
  return {
    action: 'SessionsUsage',
    success: true,
    result:
      list.length === 0
        ? 'No usage data'
        : list
            .map(
              (r: any) =>
                `${r.id} | req=${r.usage?.requests ?? 0} | tokens=${r.usage?.totalTokens ?? 0} | p=${r.usage?.promptTokens ?? 0} | c=${r.usage?.completionTokens ?? 0}`,
            )
            .join('\n'),
  };
}

export async function executeSessionsCompaction(
  _action: SessionsCompactionAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsCompaction) return null;
  const rows = await handlers.onSessionsCompaction();
  const list = Array.isArray(rows) ? rows : [];
  return {
    action: 'SessionsCompaction',
    success: true,
    result:
      list.length === 0
        ? 'No compaction data'
        : list
            .map(
              (r: any) =>
                `${r.id} | condense=${r.compaction?.condensedFallbackRuns ?? 0} | prune=${r.compaction?.pruneRuns ?? 0} | summary=${r.compaction?.summaryRuns ?? 0} | prunedTools=${r.compaction?.prunedToolOutputs ?? 0}`,
            )
            .join('\n'),
  };
}
