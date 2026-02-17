/**
 * @module plugins/explain
 *
 * Explain plugin providing a tool that pushes short status updates to the user
 * mid-reasoning. Resolves the active connector channel (Telegram, Discord, CLI)
 * from the session ID and delivers an instant explanation message.
 *
 * Tools:
 *  - `explain` -- Send a short status update to the user while the agent works.
 *
 * @see {@link createExplainPlugin} -- Plugin factory function
 */
import { z } from 'zod';
import type { ChannelDefinition, JsonValue, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk';
import type { ChannelRegistry } from '@slashbot/core/kernel/registries.js';

const PLUGIN_ID = 'slashbot.explain';

/**
 * Find the connector that owns this session.
 * Iterates channels marked as `connector: true` and matches by sessionPrefix.
 * Falls back to 'cli' when no prefix matches (TUI uses random UUIDs).
 */
function resolveConnector(channels: ChannelRegistry, sessionId?: string): ChannelDefinition | undefined {
  const connectors = channels.list().filter((ch) => ch.connector);
  if (sessionId) {
    const match = connectors.find((ch) => ch.sessionPrefix && sessionId.startsWith(ch.sessionPrefix));
    if (match) return match;
  }
  // fallback: connector without a prefix (cli)
  return connectors.find((ch) => !ch.sessionPrefix) ?? connectors[0];
}

/**
 * Create the Explain plugin.
 *
 * Registers the `explain` tool that delivers short status messages to the user's
 * active connector channel during agentic reasoning. Messages are routed based on
 * session ID prefix matching against registered connector channels.
 *
 * @returns A SlashbotPlugin instance with the explain tool registration.
 */
export function createExplainPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Explain',
      version: '0.1.0',
      main: 'bundled',
      description: 'Push short explanations to the user mid-reasoning : for example before editing a file',
    },
    setup: (context) => {
      const channels = context.getService<ChannelRegistry>('kernel.channels.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;

      context.registerTool({
        id: 'explain',
        title: 'Explain',
        pluginId: PLUGIN_ID,
        description:
          'When and how to use it : Send a short status update to the user while you work. ' +
          'Use this to explain what you are doing, why a step failed, or what you will try next. ' +
          'The message is delivered instantly to the connector the user is on (Telegram, Discord, CLI). ' +
          'Keep messages concise — one or two sentences max.',
        parameters: z.object({
          message: z.string().describe('Short explanation to show the user'),
        }),
        execute: async (args, callContext) => {
          const input = args as Record<string, JsonValue>;
          const message = typeof input.message === 'string' ? input.message : '';
          if (!message) {
            return { ok: false, error: { code: 'EMPTY', message: 'message is required' } };
          }

          if (!channels) {
            logger.warn('explain: channel registry unavailable');
            return { ok: true, output: '(no channel registry — message logged only)' };
          }

          const connector = resolveConnector(channels, callContext.sessionId);
          if (!connector) {
            logger.warn('explain: no connector found', { sessionId: callContext.sessionId ?? 'unknown' });
            return { ok: true, output: '(no connector found — message logged only)' };
          }

          try {
            await connector.send(`💡 ${message}`);
          } catch (err) {
            logger.warn('explain: send failed', { channelId: connector.id, error: String(err) });
            return { ok: false, error: { code: 'SEND_FAILED', message: String(err) } };
          }

          return { ok: true, output: 'delivered' };
        },
      });
    },
  };
}

/** Alias for {@link createExplainPlugin} conforming to the bundled plugin loader convention. */
export { createExplainPlugin as createPlugin };
