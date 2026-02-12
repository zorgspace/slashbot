/**
 * Prompt diagnostics commands
 */

import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

export const promptCommand: CommandHandler = {
  name: 'prompt',
  description: 'Show assembled prompt diagnostics',
  usage: '/prompt [report]',
  group: 'System',
  subcommands: ['report'],
  execute: async (args, context) => {
    const sub = (args[0] || 'report').toLowerCase();
    if (sub !== 'report') {
      display.muted('Usage: /prompt report');
      return true;
    }

    const report = (context.grokClient as any)?.getPromptReport?.() as
      | {
          generatedAt: string;
          totalChars: number;
          sections: Array<{ id: string; title: string; chars: number }>;
          dynamicContextCount: number;
          injectedWorkspaceFiles: Array<{ path: string; chars: number; truncated: boolean }>;
        }
      | null;

    if (!report) {
      display.muted('Prompt report not available yet. Send a message first.');
      return true;
    }

    const lines: string[] = [];
    lines.push('Prompt Report');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Total chars: ${report.totalChars}`);
    lines.push(`Sections: ${report.sections.length}`);
    for (const s of report.sections) {
      lines.push(`- ${s.id} (${s.title}): ${s.chars}`);
    }
    lines.push(`Dynamic context sections: ${report.dynamicContextCount}`);
    lines.push(`Injected workspace files: ${report.injectedWorkspaceFiles.length}`);
    for (const f of report.injectedWorkspaceFiles) {
      lines.push(`- ${f.path}: ${f.chars}${f.truncated ? ' (truncated)' : ''}`);
    }
    display.append(`\n${lines.join('\n')}\n`);
    return true;
  },
};

