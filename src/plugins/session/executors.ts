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

const MAX_HISTORY_MESSAGE_CHARS = 360;
const MAX_HISTORY_PAYLOAD_CHARS = 12_000;

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
    result: (() => {
      if (messages.length === 0) {
        return 'No messages';
      }
      let used = 0;
      const rows: string[] = [];
      for (const m of messages) {
        const content =
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? (m.content.find((p: any) => p.type === 'text')?.text ?? '[multimodal]')
              : '';
        const row = `${m.role}: ${String(content).slice(0, MAX_HISTORY_MESSAGE_CHARS)}`;
        const withSpacing = rows.length > 0 ? `\n\n${row}` : row;
        if (used + withSpacing.length > MAX_HISTORY_PAYLOAD_CHARS) {
          rows.push(
            `\n\n[truncated: output capped at ${MAX_HISTORY_PAYLOAD_CHARS} chars for context hygiene]`,
          );
          break;
        }
        rows.push(withSpacing);
        used += withSpacing.length;
      }
      return rows.join('');
    })(),
  };
}

export async function executeSessionsSend(
  action: SessionsSendAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSessionsSend) return null;
  await handlers.onSessionsSend(action.sessionId, action.message, action.run ?? false);
  const ranNow = !!action.run;
  if (!ranNow) {
    display.appendAssistantMessage(
      formatToolAction('SessionsSend', action.sessionId, {
        success: true,
        summary: 'queued',
      }),
    );
  }
  return {
    action: `SessionsSend: ${action.sessionId}`,
    success: true,
    // Do not echo target session output into the caller transcript.
    // The target session/tab is the source of truth for execution output.
    result: ranNow ? 'Delivered and executed in target session.' : 'Delivered',
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
