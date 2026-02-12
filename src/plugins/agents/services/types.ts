export type AgentKind = 'architect' | 'worker' | 'reviewer' | 'connector' | 'custom';

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
  removable?: boolean;
}

export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AgentTask {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  title: string;
  content: string;
  status: AgentTaskStatus;
  retryCount?: number;
  maxRetries?: number;
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
  removable?: boolean;
}

export interface SendTaskInput {
  fromAgentId: string;
  toAgentId: string;
  title: string;
  content: string;
}

export interface AgentRoutingRequest {
  fromAgentId: string;
  requestedToAgentId: string;
  title: string;
  content: string;
  agents: AgentProfile[];
}

export interface AgentRoutingDecision {
  toAgentId: string;
  rationale?: string;
  confidence?: number;
  taskBrief?: string;
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
