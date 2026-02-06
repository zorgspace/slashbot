/**
 * Heartbeat Action Handlers
 *
 * Handlers for heartbeat-related actions:
 * - heartbeat: Trigger a heartbeat reflection
 * - heartbeat-update: Update the HEARTBEAT.md checklist
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { HeartbeatAction, HeartbeatUpdateAction } from './types';
import { display } from '../../core/ui';

/**
 * Execute a heartbeat action - triggers immediate heartbeat reflection
 */
export async function executeHeartbeat(
  action: HeartbeatAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  display.heartbeat(action.prompt ? 'custom prompt' : 'reflection');

  try {
    if (!handlers.onHeartbeat) {
      return {
        action: 'heartbeat',
        success: false,
        result: '',
        error: 'Heartbeat handler not available',
      };
    }

    const result = await handlers.onHeartbeat(action.prompt);

    display.heartbeatResult(result.type === 'ok');

    return {
      action: 'heartbeat',
      success: true,
      result: `Heartbeat ${result.type}: ${result.content}`,
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    display.heartbeatResult(false);

    return {
      action: 'heartbeat',
      success: false,
      result: '',
      error: `Heartbeat failed: ${errorMsg}`,
    };
  }
}

/**
 * Execute a heartbeat-update action - updates HEARTBEAT.md
 */
export async function executeHeartbeatUpdate(
  action: HeartbeatUpdateAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  display.heartbeatUpdate();

  try {
    if (!handlers.onHeartbeatUpdate) {
      return {
        action: 'heartbeat-update',
        success: false,
        result: '',
        error: 'Heartbeat update handler not available',
      };
    }

    const success = await handlers.onHeartbeatUpdate(action.content);

    display.heartbeatUpdateResult(success);

    if (success) {
      return {
        action: 'heartbeat-update',
        success: true,
        result: 'HEARTBEAT.md updated successfully',
      };
    } else {
      return {
        action: 'heartbeat-update',
        success: false,
        result: '',
        error: 'Failed to update HEARTBEAT.md',
      };
    }
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    display.heartbeatUpdateResult(false);

    return {
      action: 'heartbeat-update',
      success: false,
      result: '',
      error: `Failed to update HEARTBEAT.md: ${errorMsg}`,
    };
  }
}
