/**
 * Usage diagnostics command
 */

import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const usageCommand: CommandHandler = {
  name: 'usage',
  description: 'Show token and compaction usage across sessions',
  usage: '/usage [summary|sessions|reset]',
  group: 'System',
  subcommands: ['summary', 'sessions', 'reset'],
  execute: async (args, context) => {
    const client = context.grokClient;
    if (!client) {
      display.warningText('No active AI client.');
      return true;
    }

    const mode = (args[0] || 'summary').toLowerCase();

    if (mode === 'reset') {
      client.resetUsage();
      display.successText('Global and per-session usage counters reset.');
      return true;
    }

    const global = client.getUsage();
    const sessionUsage = client.getSessionUsageSummaries();
    const sessionCompaction = new Map(
      client.getSessionCompactionSummaries().map(item => [item.id, item.compaction]),
    );

    if (mode === 'summary') {
      const lines = [
        'Usage Summary',
        `Global: ${fmtTokens(global.promptTokens)} prompt / ${fmtTokens(global.completionTokens)} completion / ${fmtTokens(global.totalTokens)} total`,
        `Global requests: ${global.requests}`,
        `Tracked sessions: ${sessionUsage.length}`,
      ];
      display.appendAssistantMessage(lines.join('\n'));
      return true;
    }

    if (mode !== 'sessions') {
      display.muted('Usage: /usage [summary|sessions|reset]');
      return true;
    }

    const rows: string[] = [];
    for (const entry of sessionUsage) {
      const usage = entry.usage;
      const comp = sessionCompaction.get(entry.id);
      rows.push(
        [
          `${entry.id}`,
          `  requests=${usage.requests} tokens=${fmtTokens(usage.totalTokens)} (p=${fmtTokens(usage.promptTokens)} c=${fmtTokens(usage.completionTokens)})`,
          `  compaction=condense:${comp?.condensedFallbackRuns || 0} prune:${comp?.pruneRuns || 0} summary:${comp?.summaryRuns || 0} prunedTools:${comp?.prunedToolOutputs || 0}`,
        ].join('\n'),
      );
    }

    if (rows.length === 0) {
      display.appendAssistantMessage('No session usage tracked yet.');
      return true;
    }

    display.appendAssistantMessage(['Session Usage', ...rows].join('\n\n'));
    return true;
  },
};
