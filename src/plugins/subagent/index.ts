/**
 * Subagent Plugin - Spawn child LLM sessions for parallel or specialized work
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { getSubagentParserConfigs } from './parser';
import { executeTask } from './executors';
import { SUBAGENT_PROMPT } from './prompt';

export class SubagentPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.subagent',
    name: 'Subagent',
    version: '1.0.0',
    category: 'feature',
    description: 'Spawn child LLM sessions for parallel exploration and specialized work',
  };

  async init(_context: PluginContext): Promise<void> {
    for (const config of getSubagentParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'task',
        tagName: 'task',
        handler: {},
        execute: executeTask,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'subagent',
        title: 'Subagent Tasks',
        priority: 18,
        content: SUBAGENT_PROMPT,
      },
    ];
  }
}
