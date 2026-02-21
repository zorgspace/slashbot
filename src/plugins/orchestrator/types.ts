export type RunStatus = 'pending' | 'running' | 'completed' | 'error' | 'killed';

export interface RunRecord {
  runId: string;
  label: string;
  task: string;
  strategy: string;
  agents: string[];
  status: RunStatus;
  background: boolean;
  depth: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  outcome?: {
    ok: boolean;
    text?: string;
    error?: string;
    agentResults?: AgentResult[];
  };
  abort?: AbortController;
}

export interface AgentResult {
  agentId: string;
  text: string;
  steps: number;
  toolCalls: number;
  finishReason: string;
  durationMs: number;
}
