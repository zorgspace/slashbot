/**
 * Shell Action Handlers - Bash and Exec operations
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { BashAction, ExecAction } from './types';
import { display, formatToolAction } from '../../core/ui';

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

  // Execute using available handler
  const output = await (handlers.onBash
    ? handlers.onBash(command, {
        timeout: options?.timeout,
        runInBackground: options?.runInBackground,
      })
    : handlers.onExec!(command));

  // Process output: keep real command output and limit to 5 lines
  let processedOutput = output || '';
  if (processedOutput) {
    const lines = processedOutput.split('\n').filter(line => line.trim());
    const limitedLines = lines.slice(0, 5);
    processedOutput = limitedLines.join('\n');
    if (lines.length > 5) {
      processedOutput += '\n... (truncated)';
    }
  }

  const isError =
    processedOutput?.startsWith('Error:') || processedOutput?.includes('Command blocked');

  const desc = options?.description ? ` (${options.description})` : '';
  display.appendAssistantMessage(
    formatToolAction('Exec', command + desc, {
      success: !isError,
      summary: isError ? 'exit 1' : undefined,
    }),
  );

  return {
    action: `Bash: ${command}`,
    success: !isError,
    result: processedOutput || 'OK',
    error: isError ? processedOutput : undefined,
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
