import type { ContextContribution, PromptSectionContribution } from './contracts.js';

function byPriority(a: { priority?: number; id: string }, b: { priority?: number; id: string }): number {
  const aPriority = a.priority ?? 100;
  const bPriority = b.priority ?? 100;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  return a.id.localeCompare(b.id);
}

export class PromptAssembler {
  private corePrompt = 'You are Slashbot, a local-first assistant.';
  private readonly sections: PromptSectionContribution[] = [];
  private readonly contextProviders: ContextContribution[] = [];

  setCorePrompt(prompt: string): void {
    this.corePrompt = prompt;
  }

  registerSection(section: PromptSectionContribution): void {
    this.sections.push(section);
  }

  registerContextProvider(provider: ContextContribution): void {
    this.contextProviders.push(provider);
  }

  async assemble(): Promise<string> {
    const orderedSections = [...this.sections].sort(byPriority).map((item) => item.content.trim());
    const orderedProviders = [...this.contextProviders].sort(byPriority);
    const contexts = await Promise.all(orderedProviders.map(async (provider) => provider.provide()));
    return [this.corePrompt, ...orderedSections, ...contexts.map((value) => value.trim())]
      .filter((value) => value.length > 0)
      .join('\n\n');
  }
}
