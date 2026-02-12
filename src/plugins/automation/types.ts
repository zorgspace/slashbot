export type AutomationJobTrigger =
  | {
      type: 'cron';
      expression: string;
      nextRunAt?: string;
    }
  | {
      type: 'webhook';
      name: string;
      secret?: string;
    };

export interface AutomationJobTarget {
  source: string;
  targetId?: string;
}

export interface AutomationJob {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  trigger: AutomationJobTrigger;
  target?: AutomationJobTarget;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
}

export interface AutomationRunContext {
  reason: 'cron' | 'webhook' | 'manual';
  webhook?: {
    name: string;
    payload: unknown;
    rawBody: string;
  };
}

export interface AutomationSummary {
  running: boolean;
  total: number;
  enabled: number;
  cron: number;
  webhook: number;
}
