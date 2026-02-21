import { z } from 'zod';
import type { JsonValue, SlashbotPlugin } from '../../plugin-sdk/index.js';
import type { ChannelRegistry } from '@slashbot/core/kernel/registries.js';
import { asObject, createLlmAdapter, resolveCommonServices } from '../utils.js';
import { HeartbeatService } from './heartbeat-service.js';

export { HeartbeatService } from './heartbeat-service.js';
export type { HeartbeatConfig, HeartbeatState } from './heartbeat-service.js';

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'heartbeat:status': { status: string };
    'heartbeat:started': Record<string, never>;
    'heartbeat:complete': { result: JsonValue; responseLength: number };
    'heartbeat:error': { error: string };
  }
}

const PLUGIN_ID = 'slashbot.heartbeat';

/**
 * Heartbeat plugin — periodic LLM reflection via HEARTBEAT.md.
 */
export function createHeartbeatPlugin(): SlashbotPlugin {
  let heartbeat: HeartbeatService;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Heartbeat',
      version: '0.1.0',
      main: 'bundled',
      description: 'Periodic LLM reflection via HEARTBEAT.md',
      dependencies: ['slashbot.providers.auth'],
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const { events, logger } = resolveCommonServices(context);
      const channelsRegistry = context.getService<ChannelRegistry>('kernel.channels.registry');
      const llm = createLlmAdapter(context);

      heartbeat = new HeartbeatService(workspaceRoot, llm, events, channelsRegistry, logger);

      context.registerService({
        id: 'heartbeat.service',
        pluginId: PLUGIN_ID,
        description: 'Periodic heartbeat reflection service',
        implementation: heartbeat,
      });

      const updateIndicatorStatus = context.contributeStatusIndicator({
        id: 'indicator.heartbeat',
        pluginId: PLUGIN_ID,
        label: 'Heartbeat',
        kind: 'service',
        priority: 50,
        statusEvent: 'heartbeat:status',
        showActivity: true,
        connectorName: 'heartbeat',
        getInitialStatus: () => {
          const s = heartbeat.getStatus();
          if (!s.enabled) return 'off';
          if (s.running) return 'running';
          const st = heartbeat.getState();
          return st.lastResult === 'error' ? 'error' : 'idle';
        },
      });
      heartbeat.setIndicatorUpdater(updateIndicatorStatus);

      context.registerTool({
        id: 'heartbeat.trigger',
        title: 'Trigger',
        pluginId: PLUGIN_ID,
        description: 'Run a heartbeat check NOW. Use when user says "run heartbeat", "check heartbeat", "trigger heartbeat". Args: { prompt?: string }',
        parameters: z.object({
          prompt: z.string().optional().describe('Custom prompt for this heartbeat run'),
        }),
        execute: async (args) => {
          try {
            const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, JsonValue>) : {};
            const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
            const result = await heartbeat.execute({ prompt, force: true });
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'heartbeat.update',
        title: 'Update',
        pluginId: PLUGIN_ID,
        description: 'Write new content to HEARTBEAT.md. Use when user says "update heartbeat", "set heartbeat content", "write heartbeat". Args: { content: string }',
        parameters: z.object({
          content: z.string().describe('New HEARTBEAT.md content'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const content = typeof input.content === 'string' ? input.content : '';
            await heartbeat.updateHeartbeatMd(content);
            return { ok: true, output: 'HEARTBEAT.md updated' };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_UPDATE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'heartbeat.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get heartbeat config, state, and run stats. Use when user says "heartbeat status", "is heartbeat running". Args: {}',
        parameters: z.object({}),
        execute: async () => {
          const config = heartbeat.getConfig();
          const state = heartbeat.getState();
          const status = heartbeat.getStatus();
          return {
            ok: true,
            output: { config, state, status } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'heartbeat.configure',
        title: 'Configure',
        pluginId: PLUGIN_ID,
        description: 'Enable, disable, or configure the heartbeat timer. Use when user says "enable heartbeat", "start heartbeat every X", "disable heartbeat", "set heartbeat interval". Args: { enabled?: boolean, interval?: string, prompt?: string, deliveryConnector?: "cli"|"telegram"|"discord" }',
        parameters: z.object({
          enabled: z.boolean().optional().describe('Enable or disable heartbeat'),
          interval: z.string().optional().describe('Interval like "1m", "30m", "1h", "60s"'),
          prompt: z.string().optional().describe('Custom heartbeat prompt'),
          deliveryConnector: z.string().optional().describe('Delivery connector: "cli", "telegram", or "discord"'),
        }),
        execute: async (args) => {
          try {
            const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, JsonValue>) : {};
            const results: string[] = [];

            if (typeof input.interval === 'string') {
              await heartbeat.setInterval(input.interval as string);
              results.push(`Interval set to ${input.interval}`);
            }

            if (typeof input.prompt === 'string') {
              await heartbeat.setPrompt(input.prompt as string);
              results.push('Prompt updated');
            }

            if (typeof input.deliveryConnector === 'string') {
              heartbeat.addDeliveryConnector(input.deliveryConnector as string);
              await heartbeat.saveConfig();
              results.push(`Delivery channel added: ${input.deliveryConnector}`);
            }

            if (input.enabled === true) {
              heartbeat.start();
              await heartbeat.saveConfig();
              results.push('Heartbeat enabled');
            } else if (input.enabled === false) {
              heartbeat.stop();
              await heartbeat.saveConfig();
              results.push('Heartbeat disabled');
            }

            if (results.length === 0) {
              return { ok: true, output: heartbeat.formatStatus() };
            }

            return { ok: true, output: results.join('. ') };
          } catch (err) {
            return { ok: false, error: { code: 'HEARTBEAT_CONFIG_ERROR', message: String(err) } };
          }
        },
      });

      context.registerCommand({
        id: 'heartbeat',
        pluginId: PLUGIN_ID,
        description: 'Heartbeat management (status, enable, disable, every, trigger, prompt, deliver, undeliver)',
        subcommands: ['status', 'enable', 'disable', 'every', 'trigger', 'prompt', 'deliver', 'undeliver'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(`${heartbeat.formatStatus()}\n`);
            return 0;
          }

          if (sub === 'enable') {
            heartbeat.start();
            await heartbeat.saveConfig();
            commandContext.stdout.write('Heartbeat enabled\n');
            return 0;
          }

          if (sub === 'disable') {
            heartbeat.stop();
            await heartbeat.saveConfig();
            commandContext.stdout.write('Heartbeat disabled\n');
            return 0;
          }

          if (sub === 'every' && args[1]) {
            await heartbeat.setInterval(args[1]);
            commandContext.stdout.write(`Heartbeat interval set to: ${args[1]}\n`);
            return 0;
          }

          if (sub === 'trigger') {
            await heartbeat.execute({ force: true });
            return 0;
          }

          if (sub === 'prompt') {
            const text = args.slice(1).join(' ').trim();
            if (!text) {
              commandContext.stdout.write(`Current prompt: ${heartbeat.getConfig().prompt}\n`);
              return 0;
            }
            await heartbeat.setPrompt(text);
            commandContext.stdout.write(`Heartbeat prompt updated\n`);
            return 0;
          }

          if (sub === 'deliver' && args[1]) {
            heartbeat.addDeliveryConnector(args[1]);
            await heartbeat.saveConfig();
            commandContext.stdout.write(`Added delivery connector: ${args[1]}\n`);
            return 0;
          }

          if (sub === 'undeliver' && args[1]) {
            heartbeat.removeDeliveryConnector(args[1]);
            await heartbeat.saveConfig();
            commandContext.stdout.write(`Removed delivery connector: ${args[1]}\n`);
            return 0;
          }

          commandContext.stderr.write(`Unknown heartbeat subcommand: ${sub}\n`);
          return 1;
        },
      });

      // Startup hook
      context.registerHook({
        id: 'heartbeat.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 60,
        handler: async () => {
          await heartbeat.loadConfig();
          await heartbeat.loadState();
          if (heartbeat.getConfig().enabled) {
            heartbeat.start();
          }
        },
      });

      // Shutdown hook
      context.registerHook({
        id: 'heartbeat.shutdown',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'shutdown',
        priority: 60,
        handler: () => {
          heartbeat.stop();
        },
      });
    },
  };
}

export { createHeartbeatPlugin as createPlugin };
