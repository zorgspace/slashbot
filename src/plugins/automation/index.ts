import type {
  ActionContribution,
  Plugin,
  PluginContext,
  PluginMetadata,
  PromptContribution,
  SidebarContribution,
  ToolContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import { registerActionParser } from '../../core/actions/parser';
import type { AutomationService } from './services/AutomationService';
import { getAutomationParserConfigs } from './parser';
import {
  executeAutomationAddCron,
  executeAutomationAddWebhook,
  executeAutomationList,
  executeAutomationRemove,
  executeAutomationRun,
  executeAutomationSetEnabled,
  executeAutomationStatus,
} from './executors';
import { AUTOMATION_PROMPT } from './prompt';
import { getAutomationToolContributions } from './tools';

function buildTargetFromAction(source?: string, targetId?: string): AutomationJobTarget | undefined {
  const normalizedSource = String(source || '')
    .trim()
    .toLowerCase();
  if (!normalizedSource || normalizedSource === 'none' || normalizedSource === '-') {
    return undefined;
  }
  const normalizedTargetId = String(targetId || '').trim();
  return {
    source: normalizedSource,
    targetId: normalizedTargetId && normalizedTargetId !== '-' ? normalizedTargetId : undefined,
  };
}

type AutomationJobTarget = { source: string; targetId?: string };

export class AutomationPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.automation',
    name: 'Automation',
    version: '1.0.0',
    category: 'feature',
    description: 'Scheduled and webhook-triggered automation jobs',
    contextInject: true,
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

    for (const config of getAutomationParserConfigs()) {
      registerActionParser(config);
    }

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
    const service = this.automationService;

    return [
      {
        type: 'automation-status',
        tagName: 'automation-status',
        handler: {
          onAutomationStatus: async () => service.getSummary(),
        },
        execute: (action, handlers) => executeAutomationStatus(action as any, handlers),
      },
      {
        type: 'automation-list',
        tagName: 'automation-list',
        handler: {
          onAutomationList: async () => service.listJobs(),
        },
        execute: (action, handlers) => executeAutomationList(action as any, handlers),
      },
      {
        type: 'automation-add-cron',
        tagName: 'automation-add-cron',
        handler: {
          onAutomationAddCron: async (input: {
            name: string;
            expression: string;
            prompt: string;
            source?: string;
            targetId?: string;
          }) =>
            await service.createCronJob({
              name: input.name,
              expression: input.expression,
              prompt: input.prompt,
              target: buildTargetFromAction(input.source, input.targetId),
            }),
        },
        execute: (action, handlers) => executeAutomationAddCron(action as any, handlers),
      },
      {
        type: 'automation-add-webhook',
        tagName: 'automation-add-webhook',
        handler: {
          onAutomationAddWebhook: async (input: {
            name: string;
            webhookName: string;
            prompt: string;
            secret?: string;
            source?: string;
            targetId?: string;
          }) =>
            await service.createWebhookJob({
              name: input.name,
              webhookName: input.webhookName,
              prompt: input.prompt,
              secret: input.secret,
              target: buildTargetFromAction(input.source, input.targetId),
            }),
        },
        execute: (action, handlers) => executeAutomationAddWebhook(action as any, handlers),
      },
      {
        type: 'automation-run',
        tagName: 'automation-run',
        handler: {
          onAutomationRun: async (selector: string) => await service.runNow(selector),
        },
        execute: (action, handlers) => executeAutomationRun(action as any, handlers),
      },
      {
        type: 'automation-remove',
        tagName: 'automation-remove',
        handler: {
          onAutomationRemove: async (selector: string) => await service.removeJob(selector),
        },
        execute: (action, handlers) => executeAutomationRemove(action as any, handlers),
      },
      {
        type: 'automation-set-enabled',
        tagName: 'automation-set-enabled',
        handler: {
          onAutomationSetEnabled: async (selector: string, enabled: boolean) =>
            await service.setJobEnabled(selector, enabled),
        },
        execute: (action, handlers) => executeAutomationSetEnabled(action as any, handlers),
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.automation.tools',
        title: 'Automation Tools',
        priority: 112,
        content: AUTOMATION_PROMPT,
      },
    ];
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

  getToolContributions(): ToolContribution[] {
    return getAutomationToolContributions();
  }
}

export type { AutomationService } from './services/AutomationService';
