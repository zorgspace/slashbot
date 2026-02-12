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
import { TYPES } from '../../core/di/types';
import { SESSION_TOOLS_PROMPT } from './prompt';
import {
  executeSessionsHistory,
  executeSessionsList,
  executeSessionsSend,
  executeSessionsUsage,
  executeSessionsCompaction,
} from './executors';
import { getSessionToolContributions } from './tools';

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function collectConnectorTargets(snapshot: any): string[] {
  const rawTargets = [
    snapshot?.status?.primaryTarget || '',
    snapshot?.status?.activeTarget || '',
    ...(Array.isArray(snapshot?.status?.authorizedTargets)
      ? snapshot.status.authorizedTargets
      : []),
  ];
  return Array.from(new Set(rawTargets.map(target => String(target || '').trim()).filter(Boolean)));
}

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

  private getVisibleSessionLookup(): Map<string, string> {
    const lookup = new Map<string, string>();
    const bind = (alias: unknown, sessionId: unknown) => {
      const aliasId = normalizeSessionId(alias);
      const target = normalizeSessionId(sessionId);
      if (!aliasId || !target) {
        return;
      }
      lookup.set(aliasId, target);
      lookup.set(aliasId.toLowerCase(), target);
    };

    bind('cli', 'cli');
    bind('main', 'cli');

    try {
      if (this.context.container.isBound(TYPES.AgentOrchestratorService)) {
        const agentService = this.context.container.get<any>(TYPES.AgentOrchestratorService);
        const agents = Array.isArray(agentService?.listAgents?.()) ? agentService.listAgents() : [];
        for (const agent of agents) {
          const sessionId = normalizeSessionId(agent?.sessionId);
          if (sessionId) {
            bind(sessionId, sessionId);
            bind(agent?.id, sessionId);
          }
        }
      }
    } catch {
      // optional service
    }

    try {
      if (this.context.container.isBound(TYPES.ConnectorRegistry)) {
        const connectorRegistry = this.context.container.get<any>(TYPES.ConnectorRegistry);
        const snapshots = Array.isArray(connectorRegistry?.getSnapshots?.())
          ? connectorRegistry.getSnapshots()
          : [];
        for (const snapshot of snapshots) {
          if (!snapshot?.running) {
            continue;
          }
          const source = String(snapshot?.id || '').trim();
          if (!source) {
            continue;
          }
          for (const targetId of collectConnectorTargets(snapshot)) {
            const sessionId = `${source}:${targetId}`;
            bind(sessionId, sessionId);
          }
        }
      }
    } catch {
      // optional service
    }

    return lookup;
  }

  private getVisibleSessionIds(): Set<string> {
    const visible = new Set<string>();
    for (const target of this.getVisibleSessionLookup().values()) {
      visible.add(target);
    }
    return visible;
  }

  private resolveTargetSessionId(input: string): string | null {
    const requested = normalizeSessionId(input);
    if (!requested) {
      return null;
    }
    const lookup = this.getVisibleSessionLookup();
    return lookup.get(requested) || lookup.get(requested.toLowerCase()) || null;
  }

  private projectRowsToVisibleSessions<T extends { id?: unknown }>(
    rows: T[],
    createPlaceholder: (id: string) => T,
  ): T[] {
    const visible = this.getVisibleSessionIds();
    const visibleRows: T[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const id = normalizeSessionId(row?.id);
      if (!id || !visible.has(id) || seen.has(id)) {
        continue;
      }
      visibleRows.push({ ...row, id } as T);
      seen.add(id);
    }

    for (const id of visible) {
      if (!seen.has(id)) {
        visibleRows.push(createPlaceholder(id));
      }
    }

    return visibleRows;
  }

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    const { sessionCommands } = await import('./commands');
    this.commands = sessionCommands;
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;
    const getClient = () =>
      (context.getGrokClient?.() ?? null) as {
        getSessionSummaries?: () => any[];
        getSessionHistoryById?: (sessionId: string) => any[];
        getSessionUsageSummaries?: () => any[];
        getSessionCompactionSummaries?: () => any[];
        sendToSession?: (
          sessionId: string,
          message: string,
          opts?: { run?: boolean; quiet?: boolean },
        ) => Promise<{ delivered: boolean; response?: string }>;
      } | null;

    return [
      {
        type: 'sessions-list',
        tagName: 'sessions-list',
        handler: {
          onSessionsList: async () => {
            const client = getClient();
            const rows = client?.getSessionSummaries?.() ?? [];
            return this.projectRowsToVisibleSessions(rows, id => ({
              id,
              messageCount: 0,
              lastActivity: 0,
              lastRole: null,
              preview: '',
            }));
          },
        },
        execute: (action, handlers) => executeSessionsList(action as any, handlers),
      },
      {
        type: 'sessions-history',
        tagName: 'sessions-history',
        handler: {
          onSessionsHistory: async (sessionId: string, limit?: number) => {
            const target = this.resolveTargetSessionId(sessionId);
            if (!target) {
              return [];
            }
            const client = getClient();
            const full = client?.getSessionHistoryById?.(target) ?? [];
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
            const target = this.resolveTargetSessionId(sessionId);
            if (!target) {
              return {
                delivered: false,
                error: `Session "${sessionId}" is not an active tab session. Use sessions_list first.`,
              };
            }
            const client = getClient();
            if (!client?.sendToSession) {
              return { delivered: false, error: 'Session client unavailable.' };
            }
            const shouldRun = typeof run === 'boolean' ? run : target.startsWith('agent:');
            const delivery = await client.sendToSession(target, message, {
              run: shouldRun,
              quiet: shouldRun ? false : true,
            });
            return { ...delivery, executed: shouldRun };
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
            const rows = client?.getSessionUsageSummaries?.() ?? [];
            return this.projectRowsToVisibleSessions(rows, id => ({
              id,
              usage: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                requests: 0,
                lastRequestAt: null,
              },
            }));
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
            const rows = client?.getSessionCompactionSummaries?.() ?? [];
            return this.projectRowsToVisibleSessions(rows, id => ({
              id,
              compaction: {
                condensedFallbackRuns: 0,
                pruneRuns: 0,
                prunedToolOutputs: 0,
                summaryRuns: 0,
                lastCompactedAt: null,
                lastSummaryChars: 0,
                lastMessagesCompressed: 0,
              },
            }));
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
