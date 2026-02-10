/**
 * Todo Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getTodoToolContributions(): ToolContribution[] {
  return [
    {
      name: 'todo_write',
      description: 'Create or update the task list. Replaces the entire list each time. Each todo has an id, status (pending/in_progress/completed), and content. Optionally add notify to push a notification on completion.',
      parameters: z.object({
        todos: z.array(z.object({
          id: z.string().describe('Unique identifier for the todo'),
          content: z.string().describe('Description of the task'),
          status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status'),
          notify: z.string().optional().describe('Connector target for push notification on completion (e.g. telegram, discord)'),
        })),
      }),
      toAction: (args) => ({
        type: 'todo-write',
        todos: (args.todos as any[]).map(t => ({
          id: t.id,
          content: t.content,
          status: t.status,
          notifyTarget: t.notify || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      }),
    },
    {
      name: 'todo_read',
      description: 'Read the current task list, optionally filtered by status.',
      parameters: z.object({
        filter: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
      }),
      toAction: (args) => ({
        type: 'todo-read',
        filter: (args.filter as string) || undefined,
      }),
    },
  ];
}
