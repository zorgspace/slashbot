/**
 * Core Say Plugin - User communication
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { executeSay, executeEnd } from './executors';
import { getSayParserConfigs } from './parser';
import { getSayToolContributions } from './tools';

export class SayPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.say',
    name: 'Say',
    version: '1.0.0',
    category: 'core',
    description: 'User communication (say, continue)',
  };

  async init(_context: PluginContext): Promise<void> {
    for (const config of getSayParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'say',
        tagName: 'say',
        handler: {},
        execute: executeSay as any,
      },
      {
        type: 'end',
        tagName: 'end',
        handler: {},
        execute: executeEnd as any,
      },
      {
        type: 'continue',
        tagName: 'continue',
        handler: {},
        execute: async () => ({ action: 'Continue', success: true, result: 'Continuing...' }),
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getSayToolContributions();
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.say.tools',
        title: 'Communication Tools',
        priority: 80,
        content: [
          '## say_message — Mid-task communication',
          '- Use for progress updates, questions, interim findings, or important discoveries.',
          '- Keep messages short (1-3 sentences). Never dump code or full file contents.',
          '',
          '## end_task — Signal task completion',
          '- Use ONLY when the task is FULLY verified and done.',
          '- IMPORTANT: `end_task` stops the agentic loop. All work must be verified before calling it.',
          '',
          '## continue_task — Reset iteration counter',
          '- Use for long-running tasks that need more iterations.',
        ].join('\n'),
      },
    ];
  }
}
