/**
 * Feature Scheduling Plugin - Task scheduling and notifications
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { executeSchedule, executeNotify } from './executors';
import { getSchedulingParserConfigs } from './parser';
import { schedulingCommands } from './commands';

export class SchedulingPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.scheduling',
    name: 'Scheduling',
    version: '1.0.0',
    category: 'feature',
    description: 'Task scheduling and push notifications',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getSchedulingParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    const getScheduler = () => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<any>(TYPES.TaskScheduler);
    };
    const getConnectorRegistry = () => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<any>(TYPES.ConnectorRegistry);
    };

    return [
      {
        type: 'schedule',
        tagName: 'schedule',
        handler: {
          onSchedule: async (
            cron: string,
            commandOrPrompt: string,
            name: string,
            options?: { isPrompt?: boolean },
          ) => {
            const scheduler = getScheduler();
            await scheduler.addTask(name, cron, commandOrPrompt, { isPrompt: options?.isPrompt });
          },
        },
        execute: executeSchedule,
      },
      {
        type: 'notify',
        tagName: 'notify',
        handler: {
          onNotify: async (message: string, target?: string) => {
            const connectorRegistry = getConnectorRegistry();
            return await connectorRegistry.notify(message, target);
          },
        },
        execute: executeNotify,
      },
    ];
  }

  getCommandContributions(): CommandHandler[] {
    return schedulingCommands;
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.scheduling.docs',
        title: 'Notify & Schedule - Push Notifications',
        priority: 130,
        content: `\`\`\`
<notify to="telegram">message to specific platform</notify>
<schedule cron="0 9 * * *" name="daily-backup">./backup.sh</schedule>
<schedule cron="0 8 * * *" name="morning-news" type="llm">Search latest tech news and notify me</schedule>
\`\`\`
- <notify> sends to specified platform
- ONLY use <notify> when user EXPLICITLY asks to be notified or for scheduled tasks
- Without type: runs bash command
- With type="llm": AI processes the task`,
      },
    ];
  }
}
