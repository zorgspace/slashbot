/**
 * Core Prompt Plugin - Provides the base system prompt and provider hints
 *
 * This is the highest-priority prompt contribution, ensuring core behavioral
 * rules appear first in the assembled system prompt.
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ContextProvider,
} from '../types';
import { CORE_PROMPT } from './prompt';
import { getProviderHints } from './provider-hints';

export class CorePromptPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.prompt',
    name: 'Core Prompt',
    version: '1.0.0',
    category: 'core',
    description: 'Base system prompt and provider-specific hints',
  };

  private provider = 'xai';

  async init(context: PluginContext): Promise<void> {
    // Read current provider from config
    try {
      const { TYPES } = await import('../../core/di/types');
      const configManager = context.container.get<any>(TYPES.ConfigManager);
      const config = configManager.getConfig();
      this.provider = config.provider || 'xai';
    } catch {
      // ConfigManager not bound yet
    }
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.prompt.base',
        title: 'Core',
        priority: 0, // Highest priority - appears first
        content: CORE_PROMPT,
      },
    ];
  }

  getContextProviders(): ContextProvider[] {
    return [
      {
        id: 'core.prompt.provider-hints',
        label: 'Provider Hints',
        priority: 999, // Lowest priority - appears last
        getContext: async () => {
          return getProviderHints(this.provider) || null;
        },
      },
    ];
  }
}
