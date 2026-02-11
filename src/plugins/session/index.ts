/**
 * Core Session Plugin - Session and configuration commands
 *
 * Commands: login, logout, config, model
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { SESSION_TOOLS_PROMPT } from './prompt';
import {
  executeSessionsHistory,
  executeSessionsList,
  executeSessionsSend,
  executeSessionsUsage,
  executeSessionsCompaction,
} from './executors';
import { getSessionToolContributions } from './tools';

export class SessionPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.session',
    name: 'Session',
    version: '1.0.0',
    category: 'core',
    description: 'Session management commands (login, logout, config, model)',
  };

  private commands: CommandHandler[] | null = null;
  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    const { sessionCommands } = await import('./commands');
    this.commands = sessionCommands;
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;
    const getClient = () =>
      (context.getGrokClient?.() ?? null) as
        | {
            getSessionSummaries?: () => any[];
            getSessionHistoryById?: (sessionId: string) => any[];
            getSessionUsageSummaries?: () => any[];
            getSessionCompactionSummaries?: () => any[];
            sendToSession?: (
              sessionId: string,
              message: string,
              opts?: { run?: boolean; quiet?: boolean },
            ) => Promise<{ delivered: boolean; response?: string }>;
          }
        | null;

    return [
      {
        type: 'sessions-list',
        tagName: 'sessions-list',
        handler: {
          onSessionsList: async () => {
            const client = getClient();
            return client?.getSessionSummaries?.() ?? [];
          },
        },
        execute: (action, handlers) => executeSessionsList(action as any, handlers),
      },
      {
        type: 'sessions-history',
        tagName: 'sessions-history',
        handler: {
          onSessionsHistory: async (sessionId: string, limit?: number) => {
            const client = getClient();
            const full = client?.getSessionHistoryById?.(sessionId) ?? [];
            const cap = Math.max(1, Math.min(200, Number(limit || 20)));
            return full.slice(-cap);
          },
        },
        execute: (action, handlers) => executeSessionsHistory(action as any, handlers),
      },
      {
        type: 'sessions-send',
        tagName: 'sessions-send',
        handler: {
          onSessionsSend: async (sessionId: string, message: string, run?: boolean) => {
            const client = getClient();
            if (!client?.sendToSession) return { delivered: false };
            return await client.sendToSession(sessionId, message, { run: !!run, quiet: true });
          },
        },
        execute: (action, handlers) => executeSessionsSend(action as any, handlers),
      },
      {
        type: 'sessions-usage',
        tagName: 'sessions-usage',
        handler: {
          onSessionsUsage: async () => {
            const client = getClient();
            return client?.getSessionUsageSummaries?.() ?? [];
          },
        },
        execute: (action, handlers) => executeSessionsUsage(action as any, handlers),
      },
      {
        type: 'sessions-compaction',
        tagName: 'sessions-compaction',
        handler: {
          onSessionsCompaction: async () => {
            const client = getClient();
            return client?.getSessionCompactionSummaries?.() ?? [];
          },
        },
        execute: (action, handlers) => executeSessionsCompaction(action as any, handlers),
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.session.tools',
        title: 'Session Tools',
        priority: 110,
        content: SESSION_TOOLS_PROMPT,
      },
    ];
  }

  getCommandContributions(): CommandHandler[] {
    return this.commands || [];
  }

  getToolContributions(): ToolContribution[] {
    return getSessionToolContributions();
  }
}
