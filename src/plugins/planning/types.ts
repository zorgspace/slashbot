/**
 * Planning Plugin Types
 */

import type { Action } from '../../core/actions/types';

export type PlanningMode = 'idle' | 'planning' | 'executing';

export interface PlanReadyAction extends Action {
  type: 'plan-ready';
  path: string;
}
