/**
 * Plugin Utilities
 */

import type { ActionContribution } from './types';
import type { ActionHandlers } from '../core/actions/types';

/**
 * Build a merged ActionHandlers object from plugin action contributions.
 * Each contribution provides handler functions that are merged into a single object.
 */
export function buildHandlersFromContributions(
  contributions: ActionContribution[],
): ActionHandlers {
  const handlers: ActionHandlers = {};

  for (const contribution of contributions) {
    // Merge handler functions into the combined handlers object
    Object.assign(handlers, contribution.handler);
  }

  return handlers;
}

/**
 * Build an action executor map from plugin contributions.
 * Maps action type -> execute function for dynamic dispatch.
 */
export function buildExecutorMap(
  contributions: ActionContribution[],
): Map<string, ActionContribution['execute']> {
  const map = new Map<string, ActionContribution['execute']>();

  for (const contribution of contributions) {
    map.set(contribution.type, contribution.execute);
  }

  return map;
}
