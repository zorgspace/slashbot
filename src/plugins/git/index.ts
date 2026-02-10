/**
 * Git Plugin - Git-aware context and operations
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ContextProvider,
  ToolContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { getGitParserConfigs } from './parser';
import { executeGitStatus, executeGitDiff, executeGitLog, executeGitCommit } from './executors';
import { GIT_PROMPT } from './prompt';
import { getGitToolContributions } from './tools';
import { getGitContextProvider } from './context';
import { gitCommands } from './commands';

export class GitPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.git',
    name: 'Git',
    version: '1.0.0',
    category: 'feature',
    description: 'Git-aware context and version control operations',
  };

  async init(_context: PluginContext): Promise<void> {
    for (const config of getGitParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'git-status',
        tagName: 'git-status',
        handler: {},
        execute: executeGitStatus,
      },
      {
        type: 'git-diff',
        tagName: 'git-diff',
        handler: {},
        execute: executeGitDiff,
      },
      {
        type: 'git-log',
        tagName: 'git-log',
        handler: {},
        execute: executeGitLog,
      },
      {
        type: 'git-commit',
        tagName: 'git-commit',
        handler: {},
        execute: executeGitCommit,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getGitToolContributions();
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'git',
        title: 'Git Operations',
        priority: 20,
        content: GIT_PROMPT,
      },
    ];
  }

  getContextProviders(): ContextProvider[] {
    return [getGitContextProvider()];
  }

  getCommandContributions(): CommandHandler[] {
    return gitCommands;
  }
}
