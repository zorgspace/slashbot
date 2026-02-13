/**
 * Feature Skills Plugin - Skill loading and installation
 * Self-registers SkillManager in DI container and provides ContextProvider for system prompt.
 */

import path from 'path';
import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ContextProvider,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { executeSkill, executeSkillInstall } from './executors';
import { getSkillsParserConfigs } from './parser';
import { skillsCommands } from './commands';
import { SKILLS_PROMPT } from './prompt';
import type { SkillManager } from './services/SkillManager';
import { getSkillsDirs } from '../../core/config/constants';

export class SkillsPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.skills',
    name: 'Skills',
    version: '1.0.0',
    category: 'feature',
    description: 'Skill loading and installation',
  };

  private context!: PluginContext;
  private skillManager!: SkillManager;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getSkillsParserConfigs()) {
      registerActionParser(config);
    }

    // Self-register SkillManager in DI container
    const { createSkillManager } = await import('./services/SkillManager');
    const { TYPES } = await import('../../core/di/types');
    if (!context.container.isBound(TYPES.SkillManager)) {
      context.container
        .bind(TYPES.SkillManager)
        .toDynamicValue(() => createSkillManager(getSkillsDirs(context.workDir)))
        .inSingletonScope();
    }

    // Init skill manager
    this.skillManager = context.container.get<SkillManager>(TYPES.SkillManager);
    await this.skillManager.init();
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    const getSkillManager = (): SkillManager => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<SkillManager>(TYPES.SkillManager);
    };

    return [
      {
        type: 'skill',
        tagName: 'skill',
        handler: {
          onSkill: async (name: string, args?: string) => {
            const skillManager = getSkillManager();
            const skill = await skillManager.getSkill(name);
            if (!skill) throw new Error(`Skill not found: ${name}`);
            let content = `[SKILL: ${name}]\n${skill.content}`;
            const skillDir = path.dirname(skill.path);
            try {
              const { readdir } = await import('fs/promises');
              const listFiles = async (dir: string, prefix = ''): Promise<string[]> => {
                const files: string[] = [];
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                  if (entry.isDirectory()) {
                    files.push(...(await listFiles(path.join(dir, entry.name), relativePath)));
                  } else if (entry.name.endsWith('.md') && entry.name !== 'skill.md') {
                    files.push(relativePath);
                  }
                }
                return files;
              };
              const availableFiles = await listFiles(skillDir);
              if (availableFiles.length > 0) {
                content += '\n\n[AVAILABLE RULE FILES]:\n';
                content += 'The following documentation files are available locally. ';
                content +=
                  'Use <read path=".slashbot/skills/' +
                  name +
                  '/FILENAME"/> to load specific rules when needed:\n';
                availableFiles.forEach(file => {
                  content += `- ${file}\n`;
                });
              }
            } catch {
              /* ignore */
            }
            if (args) content += `\n\n[TASK: ${args}]`;
            return content;
          },
        },
        execute: executeSkill,
      },
      {
        type: 'skill-install',
        tagName: 'skill-install',
        handler: {
          onSkillInstall: async (url: string, name?: string) => {
            const skillManager = getSkillManager();
            const skill = await skillManager.installSkill(url, name);
            return { name: skill.name, path: skill.path };
          },
        },
        execute: executeSkillInstall,
      },
    ];
  }

  getCommandContributions(): CommandHandler[] {
    return skillsCommands;
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.skills.docs',
        title: 'Skills - Load specialized capabilities',
        priority: 120,
        content: SKILLS_PROMPT,
      },
    ];
  }

  getContextProviders(): ContextProvider[] {
    const skillManager = this.skillManager;
    return [
      {
        id: 'skills.installed',
        label: 'Installed Skills',
        priority: 50,
        getContext: async () => {
          const prompt = await skillManager.getSkillsForSystemPrompt();
          return prompt || null;
        },
      },
    ];
  }
}
