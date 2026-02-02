/**
 * Say Handler - Display messages to the user
 */

import type { SayAction, ActionResult } from '../types';

/**
 * Execute a say action - simply returns the message for display
 */
export async function executeSay(action: SayAction): Promise<ActionResult> {
  return {
    action: 'Say',
    success: true,
    result: action.message,
  };
}
