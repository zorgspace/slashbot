/**
 * Skill Command Handlers - skill, skills
 */

import { c } from '../../ui/colors';
import { HOME_SKILLS_DIR } from '../../constants';
import type { CommandHandler } from '../registry';

export const skillCommand: CommandHandler = {
  name: 'skill',
  description: 'Manage skills (install, list, remove)',
  usage: '/skill [list|install|remove|info] [url/name]',
  aliases: ['skills'],
  execute: async (args, context) => {
    if (!context.skillManager) {
      console.log(c.error('SkillManager not available'));
      return true;
    }

    const subcommand = args[0] || 'list';

    switch (subcommand) {
      case 'list':
      case 'ls':
        const skills = await context.skillManager.listSkills();
        if (skills.length === 0) {
          console.log(c.muted('\nNo skills installed'));
          console.log(c.muted('Install with: /skill install <url>'));
          console.log(c.muted(`Skills are stored in ${HOME_SKILLS_DIR}/\n`));
        } else {
          console.log(`\n${c.violet('Installed skills:')}\n`);
          for (const skill of skills) {
            const desc = skill.metadata?.description || 'No description';
            const version = skill.metadata?.version ? ` v${skill.metadata.version}` : '';
            console.log(`  ${c.violet(skill.name)}${c.muted(version)}`);
            console.log(`    ${c.muted(desc)}`);
          }
          console.log(`\n${c.muted('Use /skill info <name> for details')}\n`);
        }
        break;

      case 'install':
      case 'add':
        const url = args[1];
        const customName = args[2];
        if (!url) {
          console.log(c.error('URL required'));
          console.log(c.muted('Usage: /skill install <url> [name]'));
          console.log(c.muted('Example: /skill install https://example.com/skill.md myskill'));
          return true;
        }

        try {
          console.log(c.muted(`Downloading skill from ${url}...`));
          const skill = await context.skillManager.installSkill(url, customName);
          console.log(c.success(`Skill installed: ${skill.name}`));
          console.log(c.muted(`Path: ${skill.path}`));
          await context.reinitializeGrok();
        } catch (error) {
          console.log(c.error(`Failed to install skill: ${error}`));
        }
        break;

      case 'remove':
      case 'rm':
      case 'delete':
        const nameToRemove = args[1];
        if (!nameToRemove) {
          console.log(c.error('Skill name required'));
          console.log(c.muted('Usage: /skill remove <name>'));
          return true;
        }

        if (await context.skillManager.removeSkill(nameToRemove)) {
          console.log(c.success(`Skill removed: ${nameToRemove}`));
          await context.reinitializeGrok();
        } else {
          console.log(c.error(`Skill not found: ${nameToRemove}`));
        }
        break;

      case 'info':
        const skillName = args[1];
        if (!skillName) {
          console.log(c.error('Skill name required'));
          console.log(c.muted('Usage: /skill info <name>'));
          return true;
        }

        const skill = await context.skillManager.getSkill(skillName);
        if (skill) {
          console.log(`\n${c.violet(`Skill: ${skill.name}`)}\n`);
          if (skill.metadata?.description) {
            console.log(`  ${c.muted('Description:')} ${skill.metadata.description}`);
          }
          if (skill.metadata?.version) {
            console.log(`  ${c.muted('Version:')} ${skill.metadata.version}`);
          }
          if (skill.metadata?.homepage) {
            console.log(`  ${c.muted('Homepage:')} ${skill.metadata.homepage}`);
          }
          if (skill.metadata?.triggers && skill.metadata.triggers.length > 0) {
            console.log(`  ${c.muted('Triggers:')} ${skill.metadata.triggers.join(', ')}`);
          }
          console.log(`  ${c.muted('Path:')} ${skill.path}`);
          console.log(`  ${c.muted('Size:')} ${skill.content.length} chars\n`);

          const preview = skill.content.split('\n').slice(0, 10).join('\n');
          console.log(`${c.muted('─── Preview ───')}`);
          console.log(preview);
          if (skill.content.split('\n').length > 10) {
            console.log(c.muted(`... and ${skill.content.split('\n').length - 10} more lines`));
          }
          console.log();
        } else {
          console.log(c.error(`Skill not found: ${skillName}`));
        }
        break;

      case 'dir':
      case 'path':
        console.log(`\n${c.muted('Skills directory:')} ${context.skillManager.getSkillsDir()}\n`);
        break;

      default:
        console.log(c.muted('Commands: list, install <url>, remove <name>, info <name>, dir'));
    }

    return true;
  },
};

export const skillHandlers: CommandHandler[] = [skillCommand];
