import type {
  ActionContribution,
  Plugin,
  PluginContext,
  PluginMetadata,
  PromptContribution,
  SidebarContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import type { AutomationService } from './services/AutomationService';

export class AutomationPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.automation',
    name: 'Automation',
    version: '1.0.0',
    category: 'feature',
    description: 'Scheduled and webhook-triggered automation jobs',
    contextInject: false,
  };

  private context!: PluginContext;
  private automationService!: AutomationService;
  private commands: CommandHandler[] = [];

  async init(context: PluginContext): Promise<void> {
    this.context = context;

    const { createAutomationService } = await import('./services/AutomationService');
    if (!context.container.isBound(TYPES.AutomationService)) {
      context.container
        .bind(TYPES.AutomationService)
        .toDynamicValue(() => {
          const eventBus = context.container.get<any>(TYPES.EventBus);
          const connectorRegistry = context.container.get<any>(TYPES.ConnectorRegistry);
          return createAutomationService({
            eventBus,
            connectorRegistry,
            workDir: context.workDir,
          });
        })
        .inSingletonScope();
    }

    this.automationService = context.container.get<AutomationService>(TYPES.AutomationService);
    this.automationService.setGrokClientResolver(
      context.getGrokClient ? () => context.getGrokClient?.() as any : null,
    );
    await this.automationService.init();
    this.automationService.start();

    const { automationCommands } = await import('./commands');
    this.commands = automationCommands;
  }

  async onAfterGrokInit(context: PluginContext): Promise<void> {
    this.automationService?.setGrokClientResolver(
      context.getGrokClient ? () => context.getGrokClient?.() as any : null,
    );
  }

  async destroy(): Promise<void> {
    this.automationService?.stop();
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }

  getCommandContributions(): CommandHandler[] {
    return this.commands;
  }

  getSidebarContributions(): SidebarContribution[] {
    return [
      {
        id: 'automation.jobs',
        label: 'Automation',
        order: 95,
        getStatus: () => {
          const summary = this.automationService?.getSummary();
          return !!summary && summary.enabled > 0;
        },
      },
    ];
  }
}

export type { AutomationService } from './services/AutomationService';
