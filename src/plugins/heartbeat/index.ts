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
    await this.heartbeatService.init();
    if (context.workDir) this.heartbeatService.setWorkDir(context.workDir);

    // Set LLM handler with lazy GrokClient resolution.
    // The GrokClient is null during plugin init (created later in initializeGrok),
    // but context.getGrokClient() resolves it at execution time.
    this.heartbeatService.setLLMHandler(async (prompt: string) => {
      const getClient = context.getGrokClient;
      if (!getClient) throw new Error('Grok client not available');
      const grokClient = getClient();
      if (!grokClient) {
        throw new Error('Grok client not initialized');
      }
      const safePrompt = `[HEARTBEAT - REFLECTION MODE]\n${prompt}`;
      const result = await (
        grokClient as {
          chat: (
            p: string,
            opts?: { saveToHistory?: boolean },
          ) => Promise<{ response?: string; thinking?: string }>;
        }
      ).chat(safePrompt, { saveToHistory: false });
      return { response: result.response || '', thinking: result.thinking };
    });

    // Start the heartbeat timer
    this.heartbeatService.start();
  }

  async destroy(): Promise<void> {
    this.heartbeatService?.stop();
  }

  getActionContributions(): ActionContribution[] {
    const heartbeatService = this.heartbeatService;

    return [
      {
        type: 'heartbeat',
        tagName: 'heartbeat',
        handler: {
          onHeartbeat: async (prompt?: string) => {
            const result = await heartbeatService.execute({ prompt });
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
    const heartbeatService = this.heartbeatService;
    return [
      {
        id: 'heartbeat',
        label: 'Heartbeat',
        order: 20,
        getStatus: () => {
          const status = heartbeatService.getStatus();
          return status.running && status.enabled;
        },
      },
    ];
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
          '- If nothing needs attention: respond with a brief status summary',
          '- If something needs attention: provide a clear alert message',
          '',
          '**Commands:** /heartbeat, /heartbeat status, /heartbeat every 30m, /heartbeat enable/disable',
          '',
          '**Alerts:** Use `<notify>` tag in HEARTBEAT.md instructions to route alerts.',
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
          '- **Alerts:** Use `<notify>` tag to route alerts.',
          '',
          'Create HEARTBEAT.md in the current working directory for custom checklists.',
        ].join('\n'),
      },
    ];
  }
}
