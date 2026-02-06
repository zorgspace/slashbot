/**
 * Code Quality Action Handlers - Format operations
 */

import type { ActionResult, ActionHandlers, FormatAction } from '../types';
import { step } from '../../ui/colors';

export async function executeFormat(
  action: FormatAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onFormat) return null;

  const pathInfo = action.path ? `(${action.path})` : '';
  step.tool('Format', pathInfo);

  try {
    const output = await handlers.onFormat(action.path);
    step.result(output || 'Formatted');

    return {
      action: 'Format',
      success: true,
      result: output || 'OK',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Format failed: ${errorMsg}`);
    return {
      action: 'Format',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
