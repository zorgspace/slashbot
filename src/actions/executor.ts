/**
 * Action Executor - Execute parsed actions with Claude Code-style display
 * Aligned with Claude Code tool schema
 */

import type { Action, ActionResult, ActionHandlers } from './types';

// Import all handlers from modular files
import {
  executeBash,
  executeExec,
  executeRead,
  executeEdit,
  executeMultiEdit,
  executeWrite,
  executeCreate,
  executeGlob,
  executeGrep,
  executeLS,
  executeGit,
  executeFetch,
  executeSearch,
  executeFormat,
  executeTypecheck,
  executeSchedule,
  executeNotify,
  executeSkill,
  executeSkillInstall,
  executeTask,
  executeExplore,
  executeTelegramConfig,
  executeDiscordConfig,
  executePlan,
} from './handlers';

/**
 * Execute actions one at a time to allow LLM to adapt based on results.
 * This saves tokens by not pre-executing all actions at once.
 *
 * @param actions - List of actions to execute
 * @param handlers - Action handlers
 * @param oneAtATime - If true, only execute the first action (default: true)
 */
export async function executeActions(
  actions: Action[],
  handlers: ActionHandlers,
  oneAtATime: boolean = true,
): Promise<ActionResult[]> {
  if (actions.length === 0) {
    return [];
  }

  const results: ActionResult[] = [];

  // Only execute the first action to let LLM adapt based on the result
  const actionsToExecute = oneAtATime ? [actions[0]] : actions;

  for (const action of actionsToExecute) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
      console.log('');
    }
  }

  return results;
}

async function executeAction(
  action: Action,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  switch (action.type) {
    // Shell Commands
    case 'bash':
      return executeBash(action, handlers);
    case 'exec':
      return executeExec(action, handlers);

    // File Operations
    case 'read':
      return executeRead(action, handlers);
    case 'edit':
      return executeEdit(action, handlers);
    case 'multi-edit':
      return executeMultiEdit(action, handlers);
    case 'write':
      return executeWrite(action, handlers);
    case 'create':
      return executeCreate(action, handlers);

    // Search & Navigation
    case 'glob':
      return executeGlob(action, handlers);
    case 'grep':
      return executeGrep(action, handlers);
    case 'ls':
      return executeLS(action, handlers);

    // Git Operations
    case 'git':
      return executeGit(action, handlers);

    // Web Operations
    case 'fetch':
      return executeFetch(action, handlers);
    case 'search':
      return executeSearch(action, handlers);

    // Code Quality
    case 'format':
      return executeFormat(action, handlers);
    case 'typecheck':
      return executeTypecheck(action, handlers);

    // Scheduling & Notifications
    case 'schedule':
      return executeSchedule(action, handlers);
    case 'notify':
      return executeNotify(action, handlers);

    // Skills
    case 'skill':
      return executeSkill(action, handlers);
    case 'skill-install':
      return executeSkillInstall(action, handlers);

    // Sub-task Spawning
    case 'task':
      return executeTask(action, handlers);

    // Parallel Exploration
    case 'explore':
      return executeExplore(action, handlers);

    // Plan Management
    case 'plan':
      return executePlan(action, handlers);

    // Connector Configuration
    case 'telegram-config':
      return executeTelegramConfig(action as any, handlers);
    case 'discord-config':
      return executeDiscordConfig(action as any, handlers);

    default:
      return null;
  }
}
