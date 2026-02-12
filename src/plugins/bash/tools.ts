/**
 * Bash Plugin - AI SDK Tool Definitions
 */

import { z } from 'zod/v4';
import type { ToolContribution } from '../types';

export function getBashToolContributions(): ToolContribution[] {
  return [
    {
      name: 'bash',
      description:
        'Execute a shell command. Returns stdout/stderr. Use for git, npm, build tools, and other CLI operations.',
      parameters: z.object({
        command: z.string().describe('The shell command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (max 600000)'),
        description: z.string().optional().describe('Short description of what this command does'),
        background: z
          .boolean()
          .optional()
          .describe('Run in background without waiting for completion'),
      }),
      toAction: args => ({
        type: 'bash',
        command: args.command as string,
        timeout: args.timeout as number | undefined,
        description: args.description as string | undefined,
        runInBackground: args.background as boolean | undefined,
      }),
    },
  ];
}
