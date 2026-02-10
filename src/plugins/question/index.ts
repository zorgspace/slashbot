/**
 * Question Plugin - Structured multi-choice questions for the user
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { getQuestionParserConfigs } from './parser';
import { executeQuestion } from './executors';
import { QUESTION_PROMPT } from './prompt';

export class QuestionPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.question',
    name: 'Question',
    version: '1.0.0',
    category: 'feature',
    description: 'Structured multi-choice questions for user interaction',
  };

  async init(_context: PluginContext): Promise<void> {
    for (const config of getQuestionParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'question',
        tagName: 'question',
        handler: {},
        execute: executeQuestion,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'question',
        title: 'Structured Questions',
        priority: 16,
        content: QUESTION_PROMPT,
      },
    ];
  }
}
