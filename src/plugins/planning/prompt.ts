/**
 * Planning Plugin Prompts
 *
 * Two prompt contributions toggled by planning mode:
 * - PLANNING_PROMPT: active during Phase 1 (exploration + plan creation)
 * - EXECUTION_PROMPT: active during Phase 2 (executing from plan file)
 */

import type { PlanningMode } from './types';

let currentMode: PlanningMode = 'idle';

export function setPlanningPromptMode(mode: PlanningMode): void {
  currentMode = mode;
}

export function getPlanningPromptMode(): PlanningMode {
  return currentMode;
}

export const PLANNING_PROMPT = [
  'You are in **PLANNING MODE**. Your SOLE objective is to explore the codebase and produce a plan file. You MUST NOT answer the user directly — your only deliverable is the plan file.',
  '',
  '## Rules',
  '- DO NOT edit or write any source files. Only read and explore.',
  '- DO NOT respond conversationally. Explore, then write the plan file.',
  '- Use `<read>`, `<grep>`, `<bash>` freely to understand the codebase.',
  '- Read ALL files relevant to the task — the plan must be self-contained.',
  '',
  '## Plan File Format',
  'Create the plan file with `<write>` at: `.slashbot/plans/plan-<descriptive-slug>.md`',
  '',
  'Structure it with these sections:',
  '',
  '```markdown',
  '# Plan: <Short Title>',
  '',
  '## Goal',
  "User request and your interpretation of what needs to happen.",
  '',
  '## Context',
  'Key architectural decisions, patterns, and constraints discovered during exploration.',
  '',
  '## Files to Modify',
  'For EACH file:',
  '- **Path**: `src/path/to/file.ts`',
  '- **Role**: what this file does in the architecture',
  '- **Current content** (relevant sections, copied from `<read>` output)',
  '',
  '## Changes',
  'For EACH change, in implementation order:',
  '### Step N: <description>',
  '- **File**: `path/to/file.ts`',
  '- **What**: what to change and why',
  '- **Code**: the exact new code (full functions/blocks, not diffs)',
  '- **Depends on**: prior steps if any',
  '',
  '## Verification',
  'How to verify the changes work (commands, expected outcomes).',
  '```',
  '',
  '## Completion',
  'After writing the plan file, you MUST signal completion:',
  '`<plan-ready path=".slashbot/plans/plan-<slug>.md"/>`',
  '',
  'CRITICAL: The plan file is the ONLY context that survives into the execution phase.',
  'Make it complete and self-contained. Every file content, every detail.',
  'You MUST produce a plan file — never just answer or explain.',
].join('\n');

export const EXECUTION_PROMPT = [
  'You are in **EXECUTION MODE**. A detailed implementation plan has been provided.',
  '',
  '## Execution Rules',
  '- Follow the plan\'s implementation order exactly.',
  '- Use the file contents in the plan as your reference for `<edit>` operations.',
  '- After each file edit, verify it applied correctly.',
  '- If a step fails, adapt but stay aligned with the plan\'s intent.',
  '- When all changes are complete, run the plan\'s verification steps.',
  '- Use `<end>` when everything is done and verified.',
  '',
  '## Important',
  '- The plan was created by a prior exploration phase — trust it.',
  '- You have a clean context with maximum room for code generation.',
  '- Focus on executing, not re-exploring.',
].join('\n');
