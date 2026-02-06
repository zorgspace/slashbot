/**
 * Prompt Assembler - Builds the complete system prompt from core + plugin contributions
 */

import { CORE_PROMPT } from './core';
import type { PromptContribution, ContextProvider } from '../../../plugins/types';

export class PromptAssembler {
  private contributions: PromptContribution[] = [];
  private contextProviders: ContextProvider[] = [];

  /**
   * Set prompt contributions from plugins (should be pre-sorted by priority)
   */
  setContributions(contributions: PromptContribution[]): void {
    this.contributions = contributions;
  }

  /**
   * Set context providers from plugins (should be pre-sorted by priority)
   */
  setContextProviders(providers: ContextProvider[]): void {
    this.contextProviders = providers;
  }

  /**
   * Assemble the complete system prompt
   */
  async assemble(): Promise<string> {
    let prompt = CORE_PROMPT;

    // Add plugin-contributed sections
    for (const contribution of this.contributions) {
      // Check if contribution is enabled
      if (contribution.enabled !== undefined) {
        const enabled =
          typeof contribution.enabled === 'function'
            ? contribution.enabled()
            : contribution.enabled;
        if (!enabled) continue;
      }

      // Resolve content
      const content =
        typeof contribution.content === 'function'
          ? await contribution.content()
          : contribution.content;

      if (content) {
        prompt += `\n\n# ${contribution.title}\n${content}`;
      }
    }

    // Add dynamic context from providers
    const contextSections: string[] = [];
    for (const provider of this.contextProviders) {
      const isActive = provider.isActive ? provider.isActive() : true;
      if (!isActive) continue;

      const context = await provider.getContext();
      if (context) {
        contextSections.push(context);
      }
    }

    if (contextSections.length > 0) {
      prompt += '\n\n# Dynamic Context\n' + contextSections.join('\n\n');
    }

    return prompt;
  }
}
