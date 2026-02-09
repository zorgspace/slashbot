/**
 * Planning Plugin — Two-phase agentic planning system
 *
 * Phase 1 (Planning): LLM explores codebase, creates a comprehensive plan file
 * Phase 2 (Execution): Context flushed, LLM executes from plan with clean context
 *
 * Trigger: user message contains planning-intent keywords (refactor, plan to, etc.)
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { getPlanningParserConfigs } from './parser';
import { executePlanReady, setExecutorEventBus } from './executors';
import {
  PLANNING_PROMPT,
  EXECUTION_PROMPT,
  setPlanningPromptMode,
  getPlanningPromptMode,
} from './prompt';
import { detectPlanningTrigger } from './trigger';
import type { PlanningMode } from './types';

export class PlanningPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.planning',
    name: 'Planning',
    version: '1.0.0',
    category: 'feature',
    description: 'Two-phase agentic planning: explore → plan → flush → execute',
  };

  async init(context: PluginContext): Promise<void> {
    for (const config of getPlanningParserConfigs()) {
      registerActionParser(config);
    }

    // Wire EventBus to executor for plan:ready emission
    try {
      const { TYPES } = require('../../core/di/types');
      const eventBus = context.container.get<any>(TYPES.EventBus);
      setExecutorEventBus(eventBus);
    } catch {
      // EventBus not yet bound
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'plan-ready',
        tagName: 'plan-ready',
        handler: {},
        execute: executePlanReady as any,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.planning.phase1',
        title: 'Planning Mode',
        priority: 5,
        content: PLANNING_PROMPT,
        enabled: () => getPlanningPromptMode() === 'planning',
      },
      {
        id: 'feature.planning.phase2',
        title: 'Execution Mode',
        priority: 5,
        content: EXECUTION_PROMPT,
        enabled: () => getPlanningPromptMode() === 'executing',
      },
    ];
  }

  // --- Public API used by the orchestrator in handleInput ---

  setMode(mode: PlanningMode): void {
    setPlanningPromptMode(mode);
  }

  getMode(): PlanningMode {
    return getPlanningPromptMode();
  }

  isActive(): boolean {
    return getPlanningPromptMode() !== 'idle';
  }

  detectTrigger(input: string): boolean {
    return detectPlanningTrigger(input);
  }
}

// Re-export for convenience
export { detectPlanningTrigger } from './trigger';
export type { PlanningMode } from './types';
