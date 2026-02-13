export type AgentKind = 'architect' | 'worker' | 'reviewer' | 'connector' | 'custom';
export type AgentLifecycleStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'stalled'
  | 'blocked'
  | 'disabled';

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
  lastHeartbeatAt?: string;
}

export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed';
export type AgentTaskVerificationStatus = 'unverified' | 'verified' | 'changes_requested';

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
  verificationStatus?: AgentTaskVerificationStatus;
  verificationNotes?: string;
  verifiedByAgentId?: string;
  verifiedAt?: string;
  recallOfTaskId?: string;
  recallCount?: number;
  runId?: string;
  stalledAt?: string;
  staleReason?: string;
  awaitingVerificationSince?: string;
  lastHeartbeatAt?: string;
  lastVerificationReminderAt?: string;
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

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'stalled' | 'archived';

export interface AgentRunRecord {
  runId: string;
  taskId: string;
  agentId: string;
  fromAgentId: string;
  status: AgentRunStatus;
  label: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  lastHeartbeatAt?: string;
  summary?: string;
  error?: string;
  archivedAt?: string;
}

export interface AgentRunState {
  version: 1;
  runs: AgentRunRecord[];
}

export interface AgentCapabilityReport {
  ready: boolean;
  requirements: string[];
  missing: string[];
  checkedAt: string;
}

export interface AgentStatusEntry {
  agentId: string;
  sessionId: string;
  name: string;
  kind: AgentKind;
  enabled: boolean;
  autoPoll: boolean;
  lifecycle: AgentLifecycleStatus;
  stats: AgentTaskStats;
  inFlightTaskId?: string;
  stalledTaskId?: string;
  lastRunAt?: string;
  lastError?: string;
  lastHeartbeatAt?: string;
  currentTask?: {
    id: string;
    title: string;
    status: AgentTaskStatus;
    queuedAt: string;
    startedAt?: string;
    updatedAt: string;
    durationMs: number;
    staleReason?: string;
    runId?: string;
  };
  capability: AgentCapabilityReport;
}

export interface AgentOrchestratorSummary {
  activeAgentId: string;
  totalAgents: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  stalled: number;
  needsVerification: number;
  activeRuns: number;
  archivedRuns: number;
  polling: boolean;
  heartbeatAt: string;
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
  stalled: number;
  needsVerification: number;
}
