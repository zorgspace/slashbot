/**
 * TUI Plugin - Full-screen terminal UI dashboard
 *
 * Manages the OpenTUI-based dashboard with header, chat, comm panel, and input.
 * Wires into display singleton, spinner callbacks, and EventBus events.
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';

export class TUIPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.tui',
    name: 'TUI',
    version: '1.0.0',
    category: 'core',
    description: 'Full-screen terminal UI dashboard',
    contextInject: false,
  };

  async init(_context: PluginContext): Promise<void> {
    // TUI initialization happens in onAfterGrokInit via Slashbot.start()
    // This plugin primarily serves as the new home for TUI code
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }
}

// Re-export TUIApp for use by index.ts / kernel
export { TUIApp } from './TUIApp';
