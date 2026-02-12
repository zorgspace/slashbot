/**
 * Git Plugin - Git worktree management
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
} from '../types';
import { GIT_PROMPT } from './prompt';
import { getGitToolContributions } from './tools';

export class GitPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.git',
    name: 'Git',
    version: '1.0.0',
    category: 'core',
    description: 'Git worktree management for agents',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getToolContributions(): ToolContribution[] {
    return getGitToolContributions();
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.git.tools',
        title: 'Git Worktree Tools',
        priority: 15,
        content: GIT_PROMPT,
      },
    ];
  }
}