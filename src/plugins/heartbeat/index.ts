/**
 * Feature Heartbeat Plugin - Periodic AI reflection system
 *
 * Manages the full heartbeat lifecycle: init, start, stop.
 * Uses lazy resolution of GrokClient via context.getGrokClient().
 * Self-registers HeartbeatService in DI container.
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
  KernelHookContribution,
  EventSubscription,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import type { HeartbeatService } from './services';
import { executeHeartbeat, executeHeartbeatUpdate } from './executors';
import { getHeartbeatParserConfigs } from './parser';

export class HeartbeatPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.heartbeat',
    name: 'Heartbeat',
    version: '1.0.0',
    category: 'feature',
    description: 'Periodic AI reflection and proactive actions',
    contextInject: false,
  };

  private context!: PluginContext;
  private heartbeatService!: HeartbeatService;
  private uiRefreshHookBound = false;
  private hadPendingAgentWork = false;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getHeartbeatParserConfigs()) {
      registerActionParser(config);
    }

    const { heartbeatCommands } = await import('./commands');
    this.heartbeatCmds = heartbeatCommands;

    // Self-register HeartbeatService in DI container
    const { createHeartbeatService } = await import('./services/HeartbeatService');
    const { TYPES } = await import('../../core/di/types');
    if (!context.container.isBound(TYPES.HeartbeatService)) {
      context.container
        .bind(TYPES.HeartbeatService)
        .toDynamicValue(() => {
          const eventBus = context.container.get<any>(TYPES.EventBus);
          return createHeartbeatService(eventBus);
        })
        .inSingletonScope();
    }

    this.heartbeatService = context.container.get<HeartbeatService>(TYPES.HeartbeatService);

    // Initialize the heartbeat service (loads config + state from disk)
    if (context.workDir) this.heartbeatService.setWorkDir(context.workDir);
    await this.heartbeatService.init();

    // Set LLM handler with lazy GrokClient resolution.
    // The GrokClient is null during plugin init (created later in initializeGrok),
    // but context.getGrokClient() resolves it at execution time.
    this.heartbeatService.setLLMHandler(async (prompt: string, runContext) => {
      const getClient = context.getGrokClient;
      if (!getClient) throw new Error('Grok client not available');
      const grokClient = getClient();
      if (!grokClient) {
        throw new Error('Grok client not initialized');
      }
      const safePrompt = `[HEARTBEAT - REFLECTION MODE]\n${prompt}`;
      const result = await (
        grokClient as {
          chatIsolated?: (
            p: string,
            opts?: {
              quiet?: boolean;
              includeFileContext?: boolean;
              continueActions?: boolean;
              executeActions?: boolean;
              maxIterations?: number;
            },
          ) => Promise<{ response?: string; thinking?: string }>;
          chat: (p: string) => Promise<{ response?: string; thinking?: string }>;
        }
      ).chatIsolated?.(safePrompt, {
        quiet: true,
        includeFileContext: false,
        continueActions: false,
        executeActions: runContext.executeActions,
        maxIterations: 1,
      }) ??
      (await (
        grokClient as {
          chat: (p: string) => Promise<{ response?: string; thinking?: string }>;
        }
      ).chat(safePrompt));
      return { response: result.response || '', thinking: result.thinking };
    });

    // Start the heartbeat timer
    this.heartbeatService.start();
  }

  async destroy(): Promise<void> {
    this.heartbeatService?.stop();
  }

  getEventSubscriptions(): EventSubscription[] {
    const heartbeatService = this.heartbeatService;
    return [
      {
        event: 'agents:updated',
        handler: (event: any) => {
          const queued = Number(event?.summary?.queued || 0);
          const running = Number(event?.summary?.running || 0);
          const hasPending = queued + running > 0;

          if (hasPending) {
            this.hadPendingAgentWork = true;
            return;
          }

          if (!this.hadPendingAgentWork) {
            return;
          }

          this.hadPendingAgentWork = false;
          heartbeatService.execute({
            silent: true,
            reason: 'agents-drained',
            force: false,
          }).catch(() => {});
        },
      },
    ];
  }

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'startup:after-ui-ready',
        order: 80,
        handler: payload => {
          if (this.uiRefreshHookBound) {
            return;
          }
          const refreshLayout = payload.refreshLayout as (() => void) | undefined;
          const eventBus = this.context?.eventBus as
            | { on: (type: string, handler: (event: any) => void) => unknown }
            | undefined;
          if (!refreshLayout || !eventBus) {
            return;
          }

          this.uiRefreshHookBound = true;
          eventBus.on('heartbeat:started', () => refreshLayout());
          eventBus.on('heartbeat:complete', () => refreshLayout());
        },
      },
    ];
  }

  getActionContributions(): ActionContribution[] {
    const heartbeatService = this.heartbeatService;

    return [
      {
        type: 'heartbeat',
        tagName: 'heartbeat',
        handler: {
          onHeartbeat: async (prompt?: string) => {
            const result = await heartbeatService.execute({ prompt, silent: true });
            return { type: result.type, content: result.content };
          },
        },
        execute: executeHeartbeat as any,
      },
      {
        type: 'heartbeat-update',
        tagName: 'heartbeat-update',
        handler: {
          onHeartbeatUpdate: async (content: string) => {
            await heartbeatService.updateHeartbeatMd(content);
            return true;
          },
        },
        execute: executeHeartbeatUpdate as any,
      },
    ];
  }

  private heartbeatCmds: CommandHandler[] | null = null;

  getCommandContributions(): CommandHandler[] {
    return this.heartbeatCmds || [];
  }

  getSidebarContributions(): SidebarContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.heartbeat.docs',
        title: 'Heartbeat - Periodic Reflection System',
        priority: 140,
        content: [
          'The heartbeat system allows periodic AI reflection and proactive actions.',
          '',
          '**Trigger a heartbeat:**',
          '```',
          '<heartbeat/>',
          '<heartbeat prompt="Check for urgent items"/>',
          '```',
          '',
          '**Update HEARTBEAT.md (your persistent checklist):**',
          '```',
          '<heartbeat-update>',
          '# My Checklist',
          '- [ ] Check for pending PRs',
          '- [ ] Review error logs',
          '</heartbeat-update>',
          '```',
          'Note: HEARTBEAT.md is loaded from the current working directory.',
          '',
          '**Response format during heartbeat:**',
          '- If nothing needs attention: reply `HEARTBEAT_OK`',
          '- If something needs attention: provide a clear alert message',
          '- `HEARTBEAT.md` that is effectively empty (headers/blank checklist only) skips runs',
          '',
          '**Commands:** /heartbeat, /heartbeat status, /heartbeat every 30m, /heartbeat enable/disable',
          '',
          '**Alerts:** Use connector tools/tags (for example `telegram_send` / `<telegram-send>`).',
        ].join('\n'),
      },
      {
        id: 'feature.heartbeat.quick',
        title: 'Heartbeat Interaction Guide',
        priority: 145,
        content: [
          'Heartbeat is a periodic reflection system for proactive task management.',
          '',
          '- **Trigger manually:** <heartbeat/> or /heartbeat now',
          '- **Set interval:** /heartbeat every 1h',
          '- **Enable/disable:** /heartbeat enable/disable',
          '- **Check status:** /heartbeat status',
          '- **Update checklist:** <heartbeat-update>content</heartbeat-update>',
          '- **Alerts:** Use connector tools/tags (for example `telegram_send` / `<telegram-send>`).',
          '',
          'Create HEARTBEAT.md in the current working directory for custom checklists.',
        ].join('\n'),
      },
    ];
  }
}
