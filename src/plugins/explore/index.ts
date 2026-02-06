/**
 * Feature Explore Plugin - Parallel multi-worker code search
 */

import type { Plugin, PluginMetadata, PluginContext, ActionContribution, PromptContribution } from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { executeExplore } from './executors';
import { getExploreParserConfigs } from './parser';

export class ExplorePlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.explore',
    name: 'Explore',
    version: '1.0.0',
    category: 'feature',
    description: 'Parallel multi-worker code search',
    dependencies: ['core.code-editor'],
  };

  async init(_context: PluginContext): Promise<void> {
    for (const config of getExploreParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'explore',
        tagName: 'explore',
        handler: {}, // Uses onGrep from code-editor plugin
        execute: executeExplore,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }
}
