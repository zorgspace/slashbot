/**
 * Say Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getSayToolContributions(): ToolContribution[] {
  return [
    {
      name: 'say_message',
      description: 'Display a message to the user during task execution. Use for progress updates, questions, or interim findings.',
      parameters: z.object({
        message: z.string().describe('Message to display to the user'),
      }),
      toAction: (args) => ({
        type: 'say',
        message: args.message as string,
      }),
      controlFlow: 'say',
    },
    {
      name: 'end_task',
      description: 'Signal task completion with a final summary message. This stops the agentic loop. Only use when the task is fully done.',
      parameters: z.object({
        message: z.string().describe('Final summary message for the user'),
      }),
      toAction: (args) => ({
        type: 'end',
        message: args.message as string,
      }),
      controlFlow: 'end',
    },
    {
      name: 'continue_task',
      description: 'Reset the iteration counter and continue working. Use for long-running tasks that need more iterations.',
      parameters: z.object({}),
      toAction: () => ({
        type: 'continue',
      }),
      controlFlow: 'continue',
    },
  ];
}
