/**
 * Node-RED Plugin - Managed Node-RED runtime lifecycle
 *
 * Thin plugin wrapper around NodeRedManager service.
 * Handles DI registration, sidebar contributions, and prompt contributions.
 *
 * @see /specs/001-nodered-lifecycle/plan.md
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import { NodeRedManager } from './services/NodeRedManager';
import { NODERED_PROMPT } from './prompt';
import type { NodeRedState } from './types';

const STATE_LABELS: Record<NodeRedState, string> = {
  disabled: 'NR: Disabled',
  unavailable: 'NR: Unavailable',
  stopped: 'NR: Stopped',
  starting: 'NR: Starting',
  running: 'NR: Running',
  failed: 'NR: Failed',
};

export class NodeRedPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.nodered',
    name: 'Node-RED',
    version: '1.0.0',
    category: 'feature',
    description: 'Managed Node-RED runtime',
  };

  private context!: PluginContext;
  private manager!: NodeRedManager;
  private noderedCmds: CommandHandler[] | null = null;

  async init(context: PluginContext): Promise<void> {
    this.context = context;

    // Create NodeRedManager with EventBus from DI
    const eventBus = context.container.get<any>(TYPES.EventBus);
    this.manager = new NodeRedManager(eventBus);

    // Self-register in DI container
    if (!context.container.isBound(TYPES.NodeRedManager)) {
      context.container
        .bind(TYPES.NodeRedManager)
        .toConstantValue(this.manager);
    }

    // Load commands
    const { noderedCommands } = await import('./commands');
    this.noderedCmds = noderedCommands;

    // Initialize manager (loads config, checks prerequisites)
    await this.manager.init();

    // Auto-start if enabled and Node.js available
    const config = this.manager.getConfig();
    const state = this.manager.getState();
    if (config.enabled && state !== 'unavailable' && state !== 'disabled') {
      await this.manager.start();
    }
  }

  async destroy(): Promise<void> {
    await this.manager?.destroy();
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getCommandContributions(): CommandHandler[] {
    return this.noderedCmds || [];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.nodered.docs',
        title: 'Node-RED Process Management',
        priority: 160,
        content: NODERED_PROMPT,
      },
    ];
  }

  getSidebarContributions(): SidebarContribution[] {
    const manager = this.manager;
    const contribution: SidebarContribution = {
      id: 'nodered',
      label: 'NR: Stopped', // Default, overridden by getter
      order: 25,
      getStatus: () => manager.getState() === 'running',
    };

    // Dynamic label via Object.defineProperty getter
    Object.defineProperty(contribution, 'label', {
      get: () => STATE_LABELS[manager.getState()] || 'NR: Unknown',
      enumerable: true,
      configurable: true,
    });

    return [contribution];
  }
}
