import { display, formatToolAction } from '../../core/ui';
import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type {
  AgentStatusAction,
  AgentCreateAction,
  AgentUpdateAction,
  AgentDeleteAction,
  AgentListAction,
  AgentTasksAction,
  AgentRunAction,
  AgentSendAction,
  AgentVerifyAction,
  AgentRecallAction,
} from './types';

export async function executeAgentStatus(
  _action: AgentStatusAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentStatus) {
      return {
        action: 'agent-status',
        success: false,
        result: '',
        error: 'Agent status handler not available',
      };
    }

    const payload = await handlers.onAgentStatus();
    const summary = payload?.summary || {};
    const agents = Array.isArray(payload?.agents) ? payload.agents : [];

    display.appendAssistantMessage(
      formatToolAction('AgentsStatus', `active=${summary.activeAgentId || 'none'}`, {
        success: true,
        summary: `${agents.length} agents`,
      }),
    );

    const lines = [
      `Active: ${summary.activeAgentId || 'none'}`,
      `Queue: ${summary.queued || 0} queued, ${summary.running || 0} running, ${summary.done || 0} done, ${summary.failed || 0} failed`,
      ...agents.map((agent: any) => {
        const poll = agent?.autoPoll ? 'poll=on' : 'poll=off';
        return `- ${agent?.id} (${agent?.name}) [${poll}]`;
      }),
    ];

    return {
      action: 'agent-status',
      success: true,
      result: lines.join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      action: 'agent-status',
      success: false,
      result: '',
      error: msg,
    };
  }
}

export async function executeAgentCreate(
  action: AgentCreateAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentCreate) {
      return {
        action: 'agent-create',
        success: false,
        result: '',
        error: 'Agent create handler not available',
      };
    }
    const created = await handlers.onAgentCreate(action);
    display.appendAssistantMessage(
      formatToolAction('AgentsCreate', action.name, {
        success: true,
        summary: created?.id || 'created',
      }),
    );
    return {
      action: 'agent-create',
      success: true,
      result: `${created?.id || action.name}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-create', success: false, result: '', error: msg };
  }
}

export async function executeAgentUpdate(
  action: AgentUpdateAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentUpdate) {
      return {
        action: 'agent-update',
        success: false,
        result: '',
        error: 'Agent update handler not available',
      };
    }
    const updated = await handlers.onAgentUpdate(action);
    display.appendAssistantMessage(
      formatToolAction('AgentsUpdate', action.agent, {
        success: !!updated,
        summary: updated ? 'updated' : 'not found',
      }),
    );
    return {
      action: 'agent-update',
      success: !!updated,
      result: updated ? updated.id || action.agent : 'Not found',
      error: updated ? undefined : `Agent not found: ${action.agent}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-update', success: false, result: '', error: msg };
  }
}

export async function executeAgentDelete(
  action: AgentDeleteAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentDelete) {
      return {
        action: 'agent-delete',
        success: false,
        result: '',
        error: 'Agent delete handler not available',
      };
    }
    const ok = await handlers.onAgentDelete(action.agent);
    display.appendAssistantMessage(
      formatToolAction('AgentsDelete', action.agent, {
        success: !!ok,
        summary: ok ? 'deleted' : 'blocked',
      }),
    );
    return {
      action: 'agent-delete',
      success: !!ok,
      result: ok ? 'Deleted' : 'Not deleted',
      error: ok ? undefined : `Delete failed for ${action.agent}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-delete', success: false, result: '', error: msg };
  }
}

export async function executeAgentList(
  _action: AgentListAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentList) {
      return {
        action: 'agent-list',
        success: false,
        result: '',
        error: 'Agent list handler not available',
      };
    }
    const agents = await handlers.onAgentList();
    const list = Array.isArray(agents) ? agents : [];
    return {
      action: 'agent-list',
      success: true,
      result: list
        .map((a: any) => `${a.id} (${a.name}) enabled=${a.enabled} autopoll=${a.autoPoll}`)
        .join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-list', success: false, result: '', error: msg };
  }
}

export async function executeAgentTasks(
  action: AgentTasksAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentTasks) {
      return {
        action: 'agent-tasks',
        success: false,
        result: '',
        error: 'Agent tasks handler not available',
      };
    }
    const tasks = await handlers.onAgentTasks(action);
    const list = Array.isArray(tasks) ? tasks : [];
    const statusFilter = action.status ? ` status=${action.status}` : '';
    return {
      action: 'agent-tasks',
      success: true,
      result: [
        `tasks=${list.length}${statusFilter}`,
        ...list.map((task: any) => {
          const verification =
            task?.verificationStatus || (task?.status === 'done' ? 'unverified' : 'n/a');
          return `${task?.id} [${task?.status}] verify=${verification} from=${task?.fromAgentId} to=${task?.toAgentId} title=${task?.title}`;
        }),
      ].join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-tasks', success: false, result: '', error: msg };
  }
}

export async function executeAgentRun(
  action: AgentRunAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentRun) {
      return {
        action: 'agent-run',
        success: false,
        result: '',
        error: 'Agent run handler not available',
      };
    }
    const ok = await handlers.onAgentRun(action.agent);
    return {
      action: 'agent-run',
      success: !!ok,
      result: ok ? 'Running next task' : 'No queued task',
      error: ok ? undefined : `No runnable task for ${action.agent}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-run', success: false, result: '', error: msg };
  }
}
export async function executeAgentSend(
  action: AgentSendAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentSend) {
      return {
        action: 'agent-send',
        success: false,
        result: '',
        error: 'Agent send handler not available',
      };
    }
    const sent = await handlers.onAgentSend(action);
    return {
      action: 'agent-send',
      success: !!sent,
      result: sent ? 'Message sent' : 'Failed to send',
      error: sent ? undefined : 'Send failed',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-send', success: false, result: '', error: msg };
  }
}

export async function executeAgentVerify(
  action: AgentVerifyAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentVerify) {
      return {
        action: 'agent-verify',
        success: false,
        result: '',
        error: 'Agent verify handler not available',
      };
    }
    const verified = await handlers.onAgentVerify(action);
    return {
      action: 'agent-verify',
      success: !!verified,
      result: verified
        ? `${verified.id} verification=${verified.verificationStatus}`
        : 'Task not found or not verifiable',
      error: verified ? undefined : `Cannot verify task ${action.taskId}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-verify', success: false, result: '', error: msg };
  }
}

export async function executeAgentRecall(
  action: AgentRecallAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentRecall) {
      return {
        action: 'agent-recall',
        success: false,
        result: '',
        error: 'Agent recall handler not available',
      };
    }
    const recalled = await handlers.onAgentRecall(action);
    return {
      action: 'agent-recall',
      success: !!recalled,
      result: recalled
        ? `Queued follow-up ${recalled.id} -> ${recalled.toAgentId}`
        : 'Task not found or not recallable',
      error: recalled ? undefined : `Cannot recall task ${action.taskId}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-recall', success: false, result: '', error: msg };
  }
}
