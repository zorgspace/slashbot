import { z } from 'zod';

export const CronTriggerSchema = z.object({
  type: z.literal('cron'),
  expression: z.string(),
}).strict();

export const WebhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  secret: z.string().optional(),
}).strict();

export const TimerTriggerSchema = z.object({
  type: z.literal('timer'),
  intervalMs: z.number(),
}).strict();

export const OnceTriggerSchema = z.object({
  type: z.literal('once'),
  runAtMs: z.number(),
}).strict();

export const DeliverSchema = z.object({
  channel: z.string(),
  chatId: z.string(),
}).strict();

export const AutomationJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  prompt: z.string(),
  trigger: z.discriminatedUnion('type', [CronTriggerSchema, WebhookTriggerSchema, TimerTriggerSchema, OnceTriggerSchema]),
  deliver: DeliverSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  lastStatus: z.enum(['ok', 'error']).optional(),
  lastError: z.string().optional(),
});

export interface CronTrigger {
  type: 'cron';
  expression: string;
}

export interface WebhookTrigger {
  type: 'webhook';
  secret?: string;
}

export interface TimerTrigger {
  type: 'timer';
  intervalMs: number;
}

export interface OnceTrigger {
  type: 'once';
  runAtMs: number;
}

export interface DeliverConfig {
  channel: string;
  chatId: string;
}

export interface AutomationJob {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  trigger: CronTrigger | WebhookTrigger | TimerTrigger | OnceTrigger;
  deliver?: DeliverConfig;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

export type AgentRunner = (prompt: string, sessionId: string) => Promise<{ text: string; toolCalls: number }>;
