/**
 * Providers Plugin - LLM provider registry and model catalog
 *
 * Self-registers ProviderRegistry in DI during init().
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { ProviderRegistry } from './registry';
import { TYPES } from '../../core/di/types';

export class ProvidersPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.providers',
    name: 'Providers',
    version: '1.0.0',
    category: 'core',
    description: 'LLM provider registry and model catalog',
  };

  async init(context: PluginContext): Promise<void> {
    // Self-register ProviderRegistry in DI
    const registry = new ProviderRegistry();
    context.container.bind(TYPES.ProviderRegistry).toConstantValue(registry);
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }
}
