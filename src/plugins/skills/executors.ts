/**
 * Skills Action Handlers - Skill and SkillInstall operations
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { SkillAction, SkillInstallAction } from './types';
import { display, formatToolAction } from '../../core/ui';

export async function executeSkill(
  action: SkillAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSkill) return null;

  const argsInfo = action.args ? ` "${action.args}"` : '';
  const detail = `${action.name}${argsInfo}`;

  try {
    const content = await handlers.onSkill(action.name, action.args);
    display.appendAssistantMessage(formatToolAction('Skill', detail, { success: true }));

    return {
      action: `Skill: ${action.name}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(formatToolAction('Skill', detail, { success: false, summary: errorMsg }));
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
  const detail = `${action.url}${nameInfo}`;

  try {
    const result = await handlers.onSkillInstall(action.url, action.name);
    display.appendAssistantMessage(
      formatToolAction('SkillInstall', detail, { success: true, summary: result.name }),
    );

    return {
      action: `SkillInstall: ${action.url}`,
      success: true,
      result: `Skill "${result.name}" installed at ${result.path}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(formatToolAction('SkillInstall', detail, { success: false, summary: errorMsg }));
    return {
      action: `SkillInstall: ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
