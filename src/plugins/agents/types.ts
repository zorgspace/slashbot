export interface AgentStatusAction {
  type: 'agent-status';
}

export interface AgentCreateAction {
  type: 'agent-create';
  name: string;
  responsibility?: string;
  systemPrompt?: string;
  autoPoll?: boolean;
}

export interface AgentUpdateAction {
  type: 'agent-update';
  agent: string;
  name?: string;
  responsibility?: string;
  systemPrompt?: string;
  enabled?: boolean;
  autoPoll?: boolean;
}

export interface AgentDeleteAction {
  type: 'agent-delete';
  agent: string;
}

export interface AgentListAction {
  type: 'agent-list';
}

export interface AgentTasksAction {
  type: 'agent-tasks';
  agent?: string;
  limit?: number;
  status?: 'queued' | 'running' | 'done' | 'failed';
}

export interface AgentRunAction {
  type: 'agent-run';
  agent: string;
}

export interface AgentSendAction {
  type: 'agent-send';
  to: string;
  title: string;
  content: string;
}

export interface AgentVerifyAction {
  type: 'agent-verify';
  taskId: string;
  status: 'verified' | 'changes_requested';
  notes?: string;
}

export interface AgentRecallAction {
  type: 'agent-recall';
  taskId: string;
  reason: string;
  title?: string;
}
