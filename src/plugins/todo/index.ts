/**
 * Todo Plugin - Built-in task list for LLM to plan and track work
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
  ToolContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { getTodoParserConfigs } from './parser';
import { executeTodoWrite, executeTodoRead, setTodoNotifyCallback } from './executors';
import { TODO_PROMPT } from './prompt';
import { getTodoToolContributions } from './tools';
import { TYPES } from '../../core/di/types';

export class TodoPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.todo',
    name: 'Todo',
    version: '1.0.0',
    category: 'feature',
    description: 'Built-in task list for planning and tracking multi-step work',
  };

  async init(context: PluginContext): Promise<void> {
    for (const config of getTodoParserConfigs()) {
      registerActionParser(config);
    }

    // Wire push notifications through ConnectorRegistry
    try {
      const connectorRegistry = context.container.get<any>(TYPES.ConnectorRegistry);
      setTodoNotifyCallback(async (message: string, target?: string) => {
        await connectorRegistry.notify(message, target);
      });
    } catch {
      // ConnectorRegistry not available - TUI notifications still work
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'todo-write',
        tagName: 'todo-write',
        handler: {},
        execute: executeTodoWrite,
      },
      {
        type: 'todo-read',
        tagName: 'todo-read',
        handler: {},
        execute: executeTodoRead,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'todo',
        title: 'Task Tracking (Todo)',
        priority: 15,
        content: TODO_PROMPT,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getTodoToolContributions();
  }

  getSidebarContributions(): SidebarContribution[] {
    return [];
  }
}