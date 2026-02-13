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
  EventSubscription,
} from '../types';
import type { ToolRegistry } from '../../core/api/toolRegistry';
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
  private context!: PluginContext;
  private toolRegistry: ToolRegistry | null = null;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    // Read current provider from config
    try {
      const { TYPES } = await import('../../core/di/types');
      const configManager = context.container.get<any>(TYPES.ConfigManager);
      const config = configManager.getConfig();
      this.provider = config.provider || 'xai';
      try {
        this.toolRegistry = context.container.get<ToolRegistry>(TYPES.ToolRegistry);
      } catch {
        this.toolRegistry = null;
      }
    } catch {
      // ConfigManager not bound yet
    }
  }

  private async buildToolingPrompt(): Promise<string> {
    if (!this.toolRegistry) {
      try {
        const { TYPES } = await import('../../core/di/types');
        this.toolRegistry = this.context.container.get<ToolRegistry>(TYPES.ToolRegistry);
      } catch {
        this.toolRegistry = null;
      }
    }
    const toolEntries = this.toolRegistry?.getToolDefinitions?.() || [];
    const toolLines =
      toolEntries.length > 0
        ? toolEntries.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')
        : '- Tool list unavailable at prompt build time. Use only tools shown in runtime context.';
    return [
      '## Tooling',
      'Tool availability (filtered by policy):',
      'Tool names are case-sensitive. Call tools exactly as listed.',
      toolLines,
      '',
      'TOOLS.md is user guidance only and does not grant extra permissions.',
    ].join('\n');
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
      {
        id: 'core.prompt.tooling',
        title: 'Tooling',
        priority: 1,
        content: async () => await this.buildToolingPrompt(),
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

  getEventSubscriptions(): EventSubscription[] {
    return [
      {
        event: 'prompt:redraw',
        handler: async () => {
          try {
            const client = this.context?.getGrokClient?.() as
              | { buildAssembledPrompt?: () => Promise<void> }
              | null
              | undefined;
            await client?.buildAssembledPrompt?.();
          } catch {
            // Best-effort redraw hook.
          }
        },
      },
    ];
  }
}
