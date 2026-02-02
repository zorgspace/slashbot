/**
 * Shell Action Handlers - Bash and Exec operations
 */

import type { ActionResult, ActionHandlers, BashAction, ExecAction } from '../types';
import { step } from '../../ui/colors';

/**
 * Execute a shell command (handles both bash and exec action types)
 */
export async function executeShellCommand(
  command: string,
  handlers: ActionHandlers,
  options?: { timeout?: number; runInBackground?: boolean; description?: string },
): Promise<ActionResult | null> {
  const handler = handlers.onBash || handlers.onExec;
  if (!handler) return null;

  // Display action with optional description
  const desc = options?.description ? ` (${options.description})` : '';
  step.bash(command + desc);

  // Execute using available handler
  const output = await (handlers.onBash
    ? handlers.onBash(command, {
        timeout: options?.timeout,
        runInBackground: options?.runInBackground,
      })
    : handlers.onExec!(command));

  const isError = output?.startsWith('Error:') || output?.includes('Command blocked');

  // Display result
  step.bashResult(command, output || '', isError ? 1 : 0);

  const truncatedCmd = command.length > 50 ? command.slice(0, 50) + '...' : command;
  return {
    action: `Bash: ${truncatedCmd}`,
    success: !isError,
    result: output || 'OK',
    error: isError ? output : undefined,
  };
}

export async function executeBash(
  action: BashAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  return executeShellCommand(action.command, handlers, {
    timeout: action.timeout,
    runInBackground: action.runInBackground,
    description: action.description,
  });
}

export async function executeExec(
  action: ExecAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  return executeShellCommand(action.command, handlers);
}
