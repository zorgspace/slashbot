/**
 * Prompt Assembler - Builds the complete system prompt from plugin contributions
 *
 * Core prompt and provider hints are now contributed by the core-prompt plugin.
 */

import { readdirSync } from 'fs';
import path from 'path';
import type { PromptContribution, ContextProvider } from '../../../plugins/plugin-types';

export interface PromptSectionReport {
  id: string;
  title: string;
  chars: number;
}

export interface InjectedWorkspaceFileReport {
  path: string;
  chars: number;
  truncated: boolean;
}

export interface PromptAssemblyReport {
  generatedAt: string;
  totalChars: number;
  sections: PromptSectionReport[];
  dynamicContextCount: number;
  injectedWorkspaceFiles: InjectedWorkspaceFileReport[];
}

const BOOTSTRAP_FILES_MEMORY_FIRST = ['MEMORY.md', 'memory.md'] as const;
const BOOTSTRAP_FILES_FULL = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
  'memory.md',
] as const;
const MAX_BOOTSTRAP_CHARS = 8_000;

export class PromptAssembler {
  private contributions: PromptContribution[] = [];
  private contextProviders: ContextProvider[] = [];
  private provider: string = 'xai';
  private lastReport: PromptAssemblyReport | null = null;

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

  getLastReport(): PromptAssemblyReport | null {
    if (!this.lastReport) return null;
    return {
      ...this.lastReport,
      sections: [...this.lastReport.sections],
      injectedWorkspaceFiles: [...this.lastReport.injectedWorkspaceFiles],
    };
  }

  /**
   * Assemble the complete system prompt
   */
  async assemble(): Promise<string> {
    let prompt = '';
    const sectionReports: PromptSectionReport[] = [];
    const injectedWorkspaceFiles: InjectedWorkspaceFileReport[] = [];

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
        const resolved =
          typeof content === 'string' ? content : (content as readonly string[]).join('\n');
        sectionReports.push({
          id: contribution.id,
          title: contribution.title,
          chars: resolved.length,
        });
        if (prompt.length === 0) {
          // First contribution (core prompt) - no header prefix
          prompt = resolved;
        } else {
          prompt += `\n\n# ${contribution.title}\n${resolved}`;
        }
      }
    }

    const fullPromptContext = process.env.SLASHBOT_FULL_PROMPT_CONTEXT === '1';

    // Add project context dynamically (light by default, full when explicitly requested)
    const cwd = process.cwd();
    if (fullPromptContext) {
      try {
        const files = readdirSync(cwd).sort();
        const fileList = files.map(f => `- ${f}`).join('\n');
        prompt += `\n\n# Project Context\nDirectory: ${cwd}\n\nFiles in directory:\n${fileList}`;
      } catch (error) {
        // If can't read, skip
      }
    } else {
      prompt += [
        '',
        '# Project Context',
        `Directory: ${cwd}`,
        'Memory-first mode is enabled: rely on memory tools for durable project context.',
      ].join('\n');
    }

    const bootstrapFiles = fullPromptContext ? BOOTSTRAP_FILES_FULL : BOOTSTRAP_FILES_MEMORY_FIRST;
    const bootstrapSections: string[] = [];
    for (const file of bootstrapFiles) {
      const full = path.join(cwd, file);
      const exists = Bun.file(full);
      if (!(await exists.exists())) continue;
      try {
        const raw = await Bun.file(full).text();
        const truncated = raw.length > MAX_BOOTSTRAP_CHARS;
        const content = truncated ? raw.slice(0, MAX_BOOTSTRAP_CHARS) : raw;
        injectedWorkspaceFiles.push({
          path: file,
          chars: raw.length,
          truncated,
        });
        bootstrapSections.push(`## ${file}\n${content}${truncated ? '\n\n[truncated]' : ''}`);
      } catch {
        // ignore unreadable file
      }
    }
    if (bootstrapSections.length > 0) {
      prompt += `\n\n# Workspace Bootstrap Files\n${bootstrapSections.join('\n\n')}`;
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

    this.lastReport = {
      generatedAt: new Date().toISOString(),
      totalChars: prompt.length,
      sections: sectionReports,
      dynamicContextCount: contextSections.length,
      injectedWorkspaceFiles,
    };

    return prompt;
  }
}
