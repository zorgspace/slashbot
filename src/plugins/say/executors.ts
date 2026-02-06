/**
 * Say Handler - Display messages to the user with markdown rendering
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { SayAction } from './types';

/**
 * Decode basic HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Execute a say action - renders markdown for terminal display, or sends to target platform
 */
export async function executeSay(
  action: SayAction,
  handlers?: ActionHandlers,
): Promise<ActionResult> {
  if (action.target && handlers?.onNotify) {
    // Send to target platform (don't call step.say() - connector will show the result)
    const result = await handlers.onNotify(action.message.trim(), action.target);
    return {
      action: 'Says',
      success: true,
      result: `Message sent to ${action.target}: ${result.sent.join(', ')}${result.failed.length ? ` (failed: ${result.failed.join(', ')})` : ''}`,
    };
  }

  // Default: decode HTML entities and return plain text
  // The display.renderMarkdown() or display.sayResult() will be called by the caller
  const decodedMessage = decodeHtmlEntities(action.message.trim());
  return {
    action: 'Says',
    success: true,
    result: decodedMessage,
  };
}
