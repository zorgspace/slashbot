/**
 * Core Say Plugin - User communication
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { executeSay, executeEnd } from './executors';
import { getSayParserConfigs } from './parser';

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

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.say.tools',
        title: 'Say - Communicate with User',
        priority: 80,
        content: [
          '```',
          '<say>Your message to the user here</say>',
          '```',
          '- Use `<say>` for mid-task communication: progress updates, questions, interim findings like important discoveries or insights.',
          '- Use `<end>` for the FINAL message when the task is complete. This will stop the agentic loop and return to the user the message.',
          '```',
          '<end>Your final summary here</end>',
          '```',
          '- IMPORTANT: `<end>` stops the agentic loop. Only use it when the task is FULLY verified and done.',
          '- Keep messages short (1-3 sentences). Never dump code or full file contents.',
        ].join('\n'),
      },
    ];
  }
}
