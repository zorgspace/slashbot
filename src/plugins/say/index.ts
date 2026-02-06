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
import { executeSay } from './executors';
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
        content: `\`\`\`
<say>Your message to the user here</say>
\`\`\`
- ALWAYS use <say> for responses to the user
- Use for: confirmations, explanations, questions, summaries
- Keeps output clean - prevents raw code/text from being dumped to console`,
      },
    ];
  }
}
