export type AgentKind = 'architect' | 'worker' | 'reviewer' | 'custom';

export interface AgentProfile {
  id: string;
  name: string;
  kind: AgentKind;
  responsibility: string;
  systemPrompt: string;
  sessionId: string;
  workspaceDir: string;
  agentDir: string;
  enabled: boolean;
  autoPoll: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
}

export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AgentTask {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  title: string;
  content: string;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  resultSummary?: string;
  error?: string;
}

export interface AgentWorkspaceState {
  version: 1;
  activeAgentId: string;
  agents: AgentProfile[];
}

export interface AgentTaskState {
  version: 1;
  tasks: AgentTask[];
}

export interface CreateAgentInput {
  name: string;
  kind?: AgentKind;
  responsibility?: string;
  systemPrompt?: string;
  autoPoll?: boolean;
}

export interface SendTaskInput {
  fromAgentId: string;
  toAgentId: string;
  title: string;
  content: string;
}

export interface AgentTaskRunResult {
  summary: string;
}

export interface AgentTaskStats {
  queued: number;
  running: number;
  done: number;
  failed: number;
}
