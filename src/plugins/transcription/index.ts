/**
 * Feature Transcription Plugin - Audio transcription via OpenAI Whisper
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';

export class TranscriptionPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.transcription',
    name: 'Transcription',
    version: '1.0.0',
    category: 'feature',
    description: 'Audio transcription via OpenAI Whisper',
  };

  async init(context: PluginContext): Promise<void> {
    // Initialize transcription if OpenAI API key is available
    try {
      const { TYPES } = await import('../../core/di/types');
      const configManager = context.container.get<any>(TYPES.ConfigManager);
      const config = configManager.getConfig();
      const openaiKey =
        config.providers?.openai?.apiKey || process.env.OPENAI_API_KEY;

      if (openaiKey) {
        const { initTranscription } = await import('./services/TranscriptionService');
        initTranscription(openaiKey);
      }
    } catch {
      // ConfigManager not bound or no API key
    }
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }
}
