/**
 * Git Action Handler - Git operations
 */

import type { ActionResult, ActionHandlers, GitAction } from '../types';
import { step } from '../../ui/colors';

export async function executeGit(
  action: GitAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGit) return null;

  const argsInfo = action.args ? ` ${action.args}` : '';
  step.tool('Git', `${action.command}${argsInfo}`);

  try {
    const output = await handlers.onGit(action.command, action.args);
    const lines = output.split('\n').filter(l => l.trim());
    const isError = output.startsWith('Error:') || output.includes('fatal:');
    const nothingToPush = output.includes('Nothing to push') || output.includes('Everything up-to-date');

    if (isError) {
      step.error(output);
    } else if (nothingToPush && action.command === 'push') {
      // Explicitly show that nothing was pushed - don't let AI think push succeeded
      step.warning('Nothing to push - no new commits to send to remote');
    } else {
      step.result(`${lines.length} line${lines.length !== 1 ? 's' : ''}\n${output}`);
    }

    // For push command, "nothing to push" is a warning, not success
    const isPushWithNothing = action.command === 'push' && nothingToPush;

    return {
      action: `Git: ${action.command}`,
      success: !isError && !isPushWithNothing,
      result: output || 'OK',
      error: isError ? output : isPushWithNothing ? 'Nothing to push - commit your changes first' : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Git failed: ${errorMsg}`);
    return {
      action: `Git: ${action.command}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
