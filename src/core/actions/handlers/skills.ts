/**
 * Skills Action Handlers - Skill and SkillInstall operations
 */

import type { ActionResult, ActionHandlers, SkillAction, SkillInstallAction } from '../types';
import { step } from '../../ui/colors';

export async function executeSkill(
  action: SkillAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSkill) return null;

  const argsInfo = action.args ? ` "${action.args}"` : '';
  step.tool('Skill', `${action.name}${argsInfo}`);

  try {
    const content = await handlers.onSkill(action.name, action.args);

    step.result(`Loaded skill: ${action.name}`);

    return {
      action: `Skill: ${action.name}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill failed: ${errorMsg}`);
    return {
      action: `Skill: ${action.name}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

export async function executeSkillInstall(
  action: SkillInstallAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSkillInstall) return null;

  const nameInfo = action.name ? ` as "${action.name}"` : '';
  step.tool('SkillInstall', `${action.url}${nameInfo}`);

  try {
    const result = await handlers.onSkillInstall(action.url, action.name);

    step.result(`Installed skill: ${result.name} → ${result.path}`);

    return {
      action: `SkillInstall: ${action.url}`,
      success: true,
      result: `Skill "${result.name}" installed at ${result.path}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill install failed: ${errorMsg}`);
    return {
      action: `SkillInstall: ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
