/**
 * Core System Plugin - System management commands
 *
 * Absorbs commands from: system, personality, images, init, update, process, plugin
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ContextProvider,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { createCommandPermissions } from './services/CommandPermissions';
import { TYPES } from '../../core/di/types';

export class SystemPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.system',
    name: 'System',
    version: '1.0.0',
    category: 'core',
    description:
      'System management commands (help, clear, history, exit, personality, images, init, update, ps, kill, plugins)',
  };

  private commands: CommandHandler[] | null = null;
  private getPersonalityMod: (() => string) | null = null;
  private getCurrentPersonality: (() => string) | null = null;

  async init(context: PluginContext): Promise<void> {
    // Self-register CommandPermissions in DI
    const permissions = createCommandPermissions();
    context.container.bind(TYPES.CommandPermissions).toConstantValue(permissions);

    const { systemPluginCommands, getPersonalityMod, getCurrentPersonality } =
      await import('./commands');
    this.commands = systemPluginCommands;
    this.getPersonalityMod = getPersonalityMod;
    this.getCurrentPersonality = getCurrentPersonality;
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }

  getCommandContributions(): CommandHandler[] {
    return this.commands || [];
  }

  getContextProviders(): ContextProvider[] {
    return [
      {
        id: 'core.system.personality',
        label: 'Personality',
        priority: 90,
        getContext: async () => {
          return this.getPersonalityMod?.() ?? '';
        },
        isActive: () => {
          return this.getCurrentPersonality?.() !== 'normal';
        },
      },
    ];
  }
}
