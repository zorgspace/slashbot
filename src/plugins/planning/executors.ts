/**
 * Planning Plugin Executors
 */

import type { ActionResult } from '../../core/actions/types';
import type { PlanReadyAction } from './types';
import type { EventBus } from '../../core/events/EventBus';
import { display } from '../../core/ui';

let eventBusRef: EventBus | null = null;

export function setExecutorEventBus(eb: EventBus): void {
  eventBusRef = eb;
}

export async function executePlanReady(action: PlanReadyAction): Promise<ActionResult> {
  const planPath = action.path;
  display.violet('Plan ready: ' + planPath);

  // Emit event so the orchestrator in handleInput can capture the path
  if (eventBusRef) {
    eventBusRef.emit({ type: 'plan:ready', planPath } as any);
  }

  return {
    action: 'PlanReady',
    success: true,
    result: planPath,
  };
}
