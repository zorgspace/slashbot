/**
 * Skill Commands - skill, skills
 */

import { display } from '../../core/ui';
import { HOME_SKILLS_DIR } from '../../core/config/constants';
import type { CommandHandler } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import type { SkillManager } from './services/SkillManager';

export const skillCommand: CommandHandler = {
  name: 'skill',
  description: 'Manage skills (install, list, remove)',
  usage: '/skill [list|install|remove|info] [url/name]',
  aliases: ['skills'],
  group: 'Skills',
  subcommands: ['list', 'install', 'remove', 'info', 'dir'],
  execute: async (args, context) => {
    let skillManager: SkillManager;
    try {
      skillManager = context.container.get<SkillManager>(TYPES.SkillManager);
    } catch {
      display.errorText('SkillManager not available');
      return true;
    }

    const subcommand = args[0] || 'list';

    switch (subcommand) {
      case 'list':
      case 'ls':
        const skills = await skillManager.listSkills();
        if (skills.length === 0) {
          display.append('');
          display.muted('No skills installed');
          display.muted('Install with: /skill install <url>');
          display.muted('Skills are stored in ' + HOME_SKILLS_DIR + '/');
          display.append('');
        } else {
          display.append('');
          display.violet('Installed skills:');
          display.append('');
          for (const skill of skills) {
            const desc = skill.metadata?.description || 'No description';
            const version = skill.metadata?.version ? ' v' + skill.metadata.version : '';
            display.violet('  ' + skill.name + version);
            display.muted('    ' + desc);
          }
          display.append('');
          display.muted('Use /skill info <name> for details');
          display.append('');
        }
        break;

      case 'install':
      case 'add':
        const url = args[1];
        const customName = args[2];
        if (!url) {
          display.errorText('URL required');
          display.muted('Usage: /skill install <url> [name]');
          display.muted('Example: /skill install https://example.com/skill.md myskill');
          return true;
        }

        try {
          display.muted('Downloading skill from ' + url + '...');
          const skill = await skillManager.installSkill(url, customName);
          display.successText('Skill installed: ' + skill.name);
          display.muted('Path: ' + skill.path);
          await context.reinitializeGrok();
        } catch (error) {
          display.errorText('Failed to install skill: ' + error);
        }
        break;

      case 'remove':
      case 'rm':
      case 'delete':
        const nameToRemove = args[1];
        if (!nameToRemove) {
          display.errorText('Skill name required');
          display.muted('Usage: /skill remove <name>');
          return true;
        }

        if (await skillManager.removeSkill(nameToRemove)) {
          display.successText('Skill removed: ' + nameToRemove);
          await context.reinitializeGrok();
        } else {
          display.errorText('Skill not found: ' + nameToRemove);
        }
        break;

      case 'info':
        const skillName = args[1];
        if (!skillName) {
          display.errorText('Skill name required');
          display.muted('Usage: /skill info <name>');
          return true;
        }

        const skill = await skillManager.getSkill(skillName);
        if (skill) {
          display.append('');
          display.violet('Skill: ' + skill.name);
          display.append('');
          if (skill.metadata?.description) {
            display.muted('  Description: ' + skill.metadata.description);
          }
          if (skill.metadata?.version) {
            display.muted('  Version: ' + skill.metadata.version);
          }
          if (skill.metadata?.homepage) {
            display.muted('  Homepage: ' + skill.metadata.homepage);
          }
          if (skill.metadata?.triggers && skill.metadata.triggers.length > 0) {
            display.muted('  Triggers: ' + skill.metadata.triggers.join(', '));
          }
          display.muted('  Path: ' + skill.path);
          display.muted('  Size: ' + skill.content.length + ' chars');
          display.append('');

          const preview = skill.content.split('\n').slice(0, 10).join('\n');
          display.muted('--- Preview ---');
          display.append(preview);
          if (skill.content.split('\n').length > 10) {
            display.muted('... and ' + (skill.content.split('\n').length - 10) + ' more lines');
          }
          display.append('');
        } else {
          display.errorText('Skill not found: ' + skillName);
        }
        break;

      case 'dir':
      case 'path':
        display.append('');
        display.muted('Skills directory: ' + skillManager.getSkillsDir());
        display.append('');
        break;

      default:
        display.muted('Commands: list, install <url>, remove <name>, info <name>, dir');
    }

    return true;
  },
};

export const skillsCommands: CommandHandler[] = [skillCommand];
