/**
 * Core Session Plugin - Session and configuration commands
 *
 * Commands: login, logout, config, model
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';

export class SessionPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.session',
    name: 'Session',
    version: '1.0.0',
    category: 'core',
    description: 'Session management commands (login, logout, config, model)',
  };

  private commands: CommandHandler[] | null = null;

  async init(_context: PluginContext): Promise<void> {
    const { sessionCommands } = await import('./commands');
    this.commands = sessionCommands;
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
}
