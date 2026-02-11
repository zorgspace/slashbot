/**
 * Session Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getSessionToolContributions(): ToolContribution[] {
  return [
    {
      name: 'sessions_list',
      description: 'List active sessions with counts and recent activity.',
      parameters: z.object({}),
      toAction: () => ({ type: 'sessions-list' }),
    },
    {
      name: 'sessions_history',
      description: 'Read recent history from a specific session.',
      parameters: z.object({
        sessionId: z.string().describe('Target session id'),
        limit: z.number().optional().describe('Maximum number of messages to return (default 20)'),
      }),
      toAction: args => ({
        type: 'sessions-history',
        sessionId: args.sessionId as string,
        limit: args.limit as number | undefined,
      }),
    },
    {
      name: 'sessions_send',
      description:
        'Send a message to another session. By default queues only; set run=true to execute now in that session.',
      parameters: z.object({
        sessionId: z.string().describe('Target session id'),
        message: z.string().describe('Message to send'),
        run: z.boolean().optional().describe('Execute immediately in target session (default false)'),
      }),
      toAction: args => ({
        type: 'sessions-send',
        sessionId: args.sessionId as string,
        message: args.message as string,
        run: args.run as boolean | undefined,
      }),
    },
    {
      name: 'sessions_usage',
      description: 'List per-session token/request usage counters.',
      parameters: z.object({}),
      toAction: () => ({ type: 'sessions-usage' }),
    },
    {
      name: 'sessions_compaction',
      description: 'List per-session compaction metrics (condense/prune/summary).',
      parameters: z.object({}),
      toAction: () => ({ type: 'sessions-compaction' }),
    },
  ];
}
