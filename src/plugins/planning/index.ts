/**
 * Planning Plugin — Two-phase agentic planning system
 *
 * Phase 1 (Planning): LLM explores codebase, creates a comprehensive plan file.
 * Phase 2 (Execution): Context flushed, LLM executes from plan with clean context.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  KernelHookContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { TYPES } from '../../core/di/types';
import type { EventBus } from '../../core/events/EventBus';
import { display } from '../../core/ui';
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

const FORCE_PLAN_PROMPT =
  'You did NOT produce a plan file. You MUST create the plan file now using <write path=".slashbot/plans/plan-<slug>.md"> with the structured format, then signal with <plan-ready path="..."/>. Do NOT explain — just write the file.';

const EXECUTION_PROMPT_INPUT = (planPath: string) =>
  [
    `Execute the implementation plan at: ${planPath}`,
    '',
    'Do not ask me to restate the plan.',
    `Read "${planPath}" yourself first, then execute it step by step.`,
  ].join('\n');

export class PlanningPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.planning',
    name: 'Planning',
    version: '1.0.0',
    category: 'feature',
    description: 'Two-phase agentic planning: explore → plan → flush → execute',
  };

  private context!: PluginContext;
  private planningInFlight = false;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getPlanningParserConfigs()) {
      registerActionParser(config);
    }

    // Wire EventBus to executor for plan:ready emission
    try {
      const eventBus = context.container.get<EventBus>(TYPES.EventBus);
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

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'input:before',
        order: 10,
        handler: async payload => {
          const source = String(payload.source || '');
          if (source !== 'cli') {
            return;
          }

          const input = typeof payload.input === 'string' ? payload.input.trim() : '';
          if (!input) {
            return;
          }

          const alreadyHandled = payload.handled === true;
          if (
            alreadyHandled ||
            this.isActive() ||
            this.planningInFlight ||
            !detectPlanningTrigger(input)
          ) {
            return;
          }

          const handled = await this.runPlanningFlow(input);
          if (!handled) {
            return;
          }

          return {
            handled: true,
            response: '',
          };
        },
      },
    ];
  }

  // --- Public API retained for compatibility ---

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

  private getGrokClient(): any | null {
    try {
      const getter = this.context?.getGrokClient;
      if (!getter) return null;
      return getter() as any;
    } catch {
      return null;
    }
  }

  private getEventBus(): EventBus | null {
    try {
      return this.context.container.get<EventBus>(TYPES.EventBus);
    } catch {
      return null;
    }
  }

  private resolveWorkDir(): string {
    try {
      const editor = this.context.container.get<any>(TYPES.CodeEditor);
      const workDir = editor?.getWorkDir?.();
      if (typeof workDir === 'string' && workDir.trim()) {
        return workDir;
      }
    } catch {
      // ignore
    }
    if (typeof this.context.workDir === 'string' && this.context.workDir.trim()) {
      return this.context.workDir;
    }
    return process.cwd();
  }

  private async runPlanningFlow(userMessage: string): Promise<boolean> {
    const grokClient = this.getGrokClient();
    if (!grokClient) {
      return false;
    }

    this.planningInFlight = true;
    let planPath: string | null = null;
    const eventBus = this.getEventBus();
    const unsubscribe = eventBus
      ? eventBus.on('plan:ready', (event: any) => {
          const nextPath = typeof event?.planPath === 'string' ? event.planPath.trim() : '';
          if (nextPath) {
            planPath = nextPath;
          }
        })
      : () => {};

    display.violet('Planning mode activated');
    display.muted('Phase 1: Exploring codebase and creating plan...');

    try {
      this.setMode('planning');
      await grokClient.buildAssembledPrompt?.();
      await grokClient.chat(userMessage, {
        displayResult: false,
        quiet: true,
      });

      if (!planPath) {
        display.muted('No plan file yet — forcing plan file creation...');
        await grokClient.chat(FORCE_PLAN_PROMPT, {
          displayResult: false,
          quiet: true,
        });
      }

      if (!planPath) {
        display.warningText('Planning phase did not produce a plan file');
        return true;
      }

      const workDir = this.resolveWorkDir();
      const fullPlanPath = path.resolve(workDir, planPath);
      if (!fs.existsSync(fullPlanPath)) {
        display.warningText(`Plan file not found on disk right now: ${planPath}`);
        display.muted('Continuing anyway using the plan path (no immediate read-back).');
      }

      display.violet('Phase 2: Executing plan with clean context...');
      display.muted(`Plan: ${planPath}`);

      grokClient.clearHistory?.();
      this.setMode('executing');
      await grokClient.buildAssembledPrompt?.();
      await grokClient.chat(EXECUTION_PROMPT_INPUT(planPath), {
        displayResult: false,
        quiet: true,
      });
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        display.errorBlock(errorMsg);
      }
      return true;
    } finally {
      unsubscribe();
      this.setMode('idle');
      await grokClient.buildAssembledPrompt?.();
      if (planPath) {
        try {
          const workDir = this.resolveWorkDir();
          const fullPlanPath = path.resolve(workDir, planPath);
          const archiveDir = path.join(workDir, '.slashbot', 'plans');
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.copyFileSync(fullPlanPath, path.join(archiveDir, path.basename(planPath)));
          fs.unlinkSync(fullPlanPath);
          display.muted(`Plan archived to .slashbot/plans/${path.basename(planPath)}`);
        } catch {
          // Ignore if already deleted or inaccessible
        }
      }
      this.planningInFlight = false;
    }
  }
}

// Re-export for convenience
export { detectPlanningTrigger } from './trigger';
export type { PlanningMode } from './types';
