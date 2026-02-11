/**
 * Prompt Assembler - Builds the complete system prompt from plugin contributions
 *
 * Core prompt and provider hints are now contributed by the core-prompt plugin.
 */

import { readdirSync } from 'fs';
import type { PromptContribution, ContextProvider } from '../../../plugins/plugin-types';

export class PromptAssembler {
  private contributions: PromptContribution[] = [];
  private contextProviders: ContextProvider[] = [];
  private provider: string = 'xai';

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
   * Set the current provider for provider-specific hints
   */
  setProvider(provider: string): void {
    this.provider = provider;
  }

  /**
   * Assemble the complete system prompt
   */
  async assemble(): Promise<string> {
    let prompt = '';

    // Add plugin-contributed sections (core prompt comes first at priority 0)
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
        if (prompt.length === 0) {
          // First contribution (core prompt) - no header prefix
          prompt =
            typeof content === 'string' ? content : (content as readonly string[]).join('\n');
        } else {
          prompt += `\n\n# ${contribution.title}\n${content}`;
        }
      }
    }

    // Add project context dynamically
    const cwd = process.cwd();
    try {
      const files = readdirSync(cwd).sort();
      const fileList = files.map(f => `- ${f}`).join('\n');
      prompt += `\n\n# Project Context\nDirectory: ${cwd}\n\nFiles in directory:\n${fileList}`;
    } catch (error) {
      // If can't read, skip
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
