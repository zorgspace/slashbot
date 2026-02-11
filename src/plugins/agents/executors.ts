import { display, formatToolAction } from '../../core/ui';
import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type {
  AgentSendAction,
  AgentStatusAction,
  AgentCreateAction,
  AgentUpdateAction,
  AgentDeleteAction,
  AgentListAction,
  AgentRunAction,
} from './types';

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

    const created = await handlers.onAgentSend(action.to, action.title || 'Task', action.content);
    display.appendAssistantMessage(
      formatToolAction('AgentSend', `${action.to}: ${action.title || 'Task'}`, {
        success: true,
        summary: created?.id || 'queued',
      }),
    );

    return {
      action: 'agent-send',
      success: true,
      result: `Task queued for ${action.to}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction('AgentSend', `${action.to}: ${action.title || 'Task'}`, {
        success: false,
      }),
    );
    return {
      action: 'agent-send',
      success: false,
      result: '',
      error: msg,
    };
  }
}

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
      formatToolAction('AgentsStatus', `active=${summary.activeAgentId || 'agent-1'}`, {
        success: true,
        summary: `${agents.length} agents`,
      }),
    );

    const lines = [
      `Active: ${summary.activeAgentId || 'agent-1'}`,
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
      return { action: 'agent-create', success: false, result: '', error: 'Agent create handler not available' };
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
      return { action: 'agent-update', success: false, result: '', error: 'Agent update handler not available' };
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
      return { action: 'agent-delete', success: false, result: '', error: 'Agent delete handler not available' };
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
      return { action: 'agent-list', success: false, result: '', error: 'Agent list handler not available' };
    }
    const agents = await handlers.onAgentList();
    const list = Array.isArray(agents) ? agents : [];
    return {
      action: 'agent-list',
      success: true,
      result: list.map((a: any) => `${a.id} (${a.name}) enabled=${a.enabled} autopoll=${a.autoPoll}`).join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'agent-list', success: false, result: '', error: msg };
  }
}

export async function executeAgentRun(
  action: AgentRunAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  try {
    if (!handlers.onAgentRun) {
      return { action: 'agent-run', success: false, result: '', error: 'Agent run handler not available' };
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
