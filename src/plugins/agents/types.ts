export interface AgentSendAction {
  type: 'agent-send';
  to: string;
  title?: string;
  content: string;
}

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

export interface AgentRunAction {
  type: 'agent-run';
  agent: string;
}
