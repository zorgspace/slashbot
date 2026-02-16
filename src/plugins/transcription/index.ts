import { promises as fsPromises } from 'node:fs';
import { z } from 'zod';
import type { PathResolver, SlashbotPlugin } from '@slashbot/plugin-sdk';
import type { TranscriptionProvider } from '../services/transcription-service.js';
import { OpenAIWhisperTranscription } from '../services/transcription-service.js';

const TranscriptionConfigSchema = z.object({
  apiKey: z.string().optional(),
});

const PLUGIN_ID = 'slashbot.transcription';

interface TranscriptionConfig {
  apiKey?: string;
}

/**
 * Transcription plugin — OpenAI Whisper audio-to-text service.
 *
 * Provides a lazy-initialized transcription service used by Telegram/Discord
 * connectors for voice message processing. Configurable via saved API key or
 * OPENAI_API_KEY environment variable.
 *
 * Commands:
 *  - `/transcription status`            — Check if transcription is configured.
 *  - `/transcription setup <api-key>`   — Save OpenAI API key and activate service.
 *
 * Services:
 *  - `transcription.service` — TranscriptionProvider proxy (delegates to real service when configured).
 *
 * Hooks:
 *  - `transcription.startup` — Load saved API key or fall back to OPENAI_API_KEY env var.
 */
export function createTranscriptionPlugin(): SlashbotPlugin {
  let service: TranscriptionProvider | null = null;
  let configPath = '';
  let homeDir = '';

  async function loadConfig(): Promise<TranscriptionConfig> {
    try {
      const data = await fsPromises.readFile(configPath, 'utf8');
      const result = TranscriptionConfigSchema.safeParse(JSON.parse(data));
      return result.success ? result.data : {};
    } catch {
      return {};
    }
  }

  async function saveConfig(config: TranscriptionConfig): Promise<void> {
    await fsPromises.mkdir(homeDir, { recursive: true });
    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  // Proxy that delegates to the real service (swappable at runtime)
  const proxy: TranscriptionProvider = {
    async transcribe(buffer: Buffer, filename?: string) {
      if (!service) throw new Error('Transcription not configured. Run: /transcription setup <openai-api-key>');
      return service.transcribe(buffer, filename);
    },
    async transcribeFromUrl(url: string) {
      if (!service) throw new Error('Transcription not configured. Run: /transcription setup <openai-api-key>');
      return service.transcribeFromUrl(url);
    },
  } as TranscriptionProvider;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Transcription',
      version: '0.1.0',
      main: 'bundled',
      description: 'OpenAI Whisper transcription service',
    },
    setup: (context) => {
      const paths = context.getService<PathResolver>('kernel.paths')!;
      homeDir = paths.home();
      configPath = paths.home('transcription.json');

      // Always register the service (proxy); callers get errors if not configured
      context.registerService({
        id: 'transcription.service',
        pluginId: PLUGIN_ID,
        description: 'OpenAI Whisper transcription service',
        implementation: proxy,
      });

      // Command
      context.registerCommand({
        id: 'transcription',
        pluginId: PLUGIN_ID,
        description: 'Transcription service management',
        subcommands: ['status', 'setup'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'status';

          if (sub === 'status') {
            commandContext.stdout.write(
              service
                ? 'Transcription: configured (OpenAI Whisper)\n'
                : 'Transcription: not configured\nRun: /transcription setup <openai-api-key>\n',
            );
            return 0;
          }

          if (sub === 'setup') {
            const key = args[1];
            if (!key) {
              commandContext.stderr.write('Usage: /transcription setup <openai-api-key>\n');
              return 1;
            }
            await saveConfig({ apiKey: key });
            service = new OpenAIWhisperTranscription(key);
            commandContext.stdout.write('Transcription API key saved. Service active.\n');
            return 0;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\n`);
          return 1;
        },
      });

      // Startup hook: load saved key or fall back to env
      context.registerHook({
        id: 'transcription.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 50,
        handler: async () => {
          const config = await loadConfig();
          const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
          if (apiKey) {
            service = new OpenAIWhisperTranscription(apiKey);
            context.logger.info('Transcription service ready');
          } else {
            context.logger.debug('Transcription not configured — run /transcription setup <key>');
          }
        },
      });
    },
  };
}

export { createTranscriptionPlugin as createPlugin };
