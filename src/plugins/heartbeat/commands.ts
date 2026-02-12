/**
 * Heartbeat Commands
 */

import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import { parseDurationOrNull, formatDuration } from './services';
import type { HeartbeatService } from './services';

export const heartbeatHandler: CommandHandler = {
  name: 'heartbeat',
  aliases: ['hb', 'pulse'],
  description: 'Manage heartbeat system - periodic AI reflection',
  usage: '/heartbeat [status|config|every|enable|disable|hours|now]',
  group: 'Heartbeat',
  subcommands: ['now', 'status', 'config', 'every', 'period', 'enable', 'disable', 'hours', 'md'],

  async execute(args: string[], context: CommandContext): Promise<boolean> {
    const assistantBlock = (content: string) => display.renderMarkdown(content, true);

    let heartbeatService: HeartbeatService;
    try {
      heartbeatService = context.container.get<HeartbeatService>(TYPES.HeartbeatService);
    } catch {
      display.errorText('Heartbeat service not available');
      return true;
    }

    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'now' || subcommand === 'trigger') {
      assistantBlock('Triggering heartbeat...');
      const result = await heartbeatService.execute({ silent: true, reason: 'manual' });
      if (result.status === 'skipped') {
        assistantBlock(`Heartbeat skipped: ${result.skipReason || 'unknown'}`);
      } else if (result.type === 'ok') {
        assistantBlock('Heartbeat OK');
      } else if (result.type === 'alert') {
        if (result.content.trim()) {
          const preview = result.content.split('\n').join(' ').slice(0, 180);
          assistantBlock(
            `Heartbeat alert:\n\n${preview}${result.content.length > preview.length ? '...' : ''}`,
          );
        } else {
          assistantBlock('Heartbeat alert emitted');
        }
      } else if (result.type === 'error') {
        display.errorText('Heartbeat error: ' + result.content);
      }
      return true;
    }

    if (subcommand === 'status' || subcommand === 's') {
      const status = heartbeatService.getStatus();
      const inline = (value: unknown) => display.formatInline(value);
      assistantBlock(
        [
          '## Heartbeat Status',
          '',
          `- Running: ${inline(status.running ? 'Yes' : 'No')}`,
          `- Enabled: ${inline(status.enabled ? 'Yes' : 'No')}`,
          `- Interval: ${inline(status.interval)}`,
          `- Next run: ${inline(status.nextRun || 'N/A')}`,
          `- Last run: ${inline(status.lastRun || 'Never')}`,
          `- Last result: ${inline(status.lastResult || 'N/A')}`,
          status.lastSkippedReason ? `- Last skip: ${inline(status.lastSkippedReason)}` : '',
          '',
          '### Statistics',
          `- Total runs: ${inline(status.totalRuns)}`,
          `- Total alerts: ${inline(status.totalAlerts)}`,
          `- Total skips: ${inline(status.totalSkips)}`,
          `- Consecutive OKs: ${inline(status.consecutiveOks)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      return true;
    }

    if (subcommand === 'config' || subcommand === 'c') {
      const config = heartbeatService.getConfig();
      const inline = (value: unknown) => display.formatInline(value);
      const activeHours = (() => {
        if (!config.activeHours) return '';
        if (typeof config.activeHours === 'string') return inline(config.activeHours);
        if (config.activeHours && typeof config.activeHours === 'object') {
          const start = (config.activeHours as any).start;
          const end = (config.activeHours as any).end;
          const timezone = (config.activeHours as any).timezone;
          if (start && end) {
            return `${inline(start)} - ${inline(end)}${timezone ? ` (${inline(timezone)})` : ''}`;
          }
        }
        return inline(config.activeHours);
      })();

      assistantBlock(
        [
          '## Heartbeat Configuration',
          '',
          `- enabled: ${inline(config.enabled ?? true)}`,
          `- period: ${inline(config.period || '30m')}`,
          `- ackMaxChars: ${inline(config.ackMaxChars || 300)}`,
          `- includeReasoning: ${inline(config.includeReasoning ?? false)}`,
          `- dedupeWindowMs: ${inline(config.dedupeWindowMs)}`,
          activeHours ? `- activeHours: ${activeHours}` : '',
          '',
          '### Visibility',
          `- showOk: ${inline(config.visibility?.showOk ?? false)}`,
          `- showAlerts: ${inline(config.visibility?.showAlerts ?? true)}`,
          `- useIndicator: ${inline(config.visibility?.useIndicator ?? true)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      return true;
    }

    if (subcommand === 'every' || subcommand === 'period' || subcommand === 'interval') {
      const interval = args[1];
      if (!interval) {
        display.errorText('Usage: /heartbeat every <interval>');
        assistantBlock('Examples: `30m`, `1h`, `2h30m`, `5`\n\nBare numbers default to minutes.');
        return true;
      }

      const ms = parseDurationOrNull(interval, { defaultUnit: 'm' });
      if (!ms || ms < 60000) {
        display.errorText('Minimum interval is 1 minute');
        return true;
      }

      await heartbeatService.saveConfig({ period: interval });
      assistantBlock('Heartbeat interval set to ' + formatDuration(ms));
      return true;
    }

    if (subcommand === 'enable' || subcommand === 'on') {
      await heartbeatService.saveConfig({ enabled: true });
      heartbeatService.start();
      assistantBlock('Heartbeat enabled');
      return true;
    }

    if (subcommand === 'disable' || subcommand === 'off') {
      heartbeatService.stop();
      await heartbeatService.saveConfig({ enabled: false });
      assistantBlock('Heartbeat disabled');
      return true;
    }

    if (subcommand === 'hours') {
      const range = args[1];
      if (!range) {
        await heartbeatService.saveConfig({ activeHours: undefined });
        assistantBlock('Active hours cleared (heartbeat runs 24/7)');
        return true;
      }

      const match = range.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!match) {
        display.errorText('Usage: /heartbeat hours <HH:MM-HH:MM>');
        assistantBlock(
          'Example: `/heartbeat hours 08:00-22:00`\n\nUse `/heartbeat hours` (no args) to clear.',
        );
        return true;
      }

      await heartbeatService.saveConfig({ activeHours: { start: match[1], end: match[2] } });
      assistantBlock(`Active hours set to ${match[1]} - ${match[2]}`);
      return true;
    }

    if (subcommand === 'md' || subcommand === 'checklist') {
      const content = await heartbeatService.readHeartbeatMd();
      if (content) {
        assistantBlock(`## HEARTBEAT.md\n\n\`\`\`md\n${content}\n\`\`\``);
      } else {
        assistantBlock(
          'No `HEARTBEAT.md` found in current directory.\n\nCreate one to guide heartbeats.',
        );
      }
      return true;
    }

    assistantBlock(`## Heartbeat Commands

- \`/heartbeat\` Trigger heartbeat now
- \`/heartbeat status\` Show status and statistics
- \`/heartbeat config\` Show current configuration
- \`/heartbeat every 30m\` Set interval (\`30m\`, \`1h\`, \`2h30m\`, \`5=5m\`)
- \`/heartbeat enable\` Enable heartbeat
- \`/heartbeat disable\` Disable heartbeat
- \`/heartbeat hours 8:00-22:00\` Set active hours
- \`/heartbeat md\` Show HEARTBEAT.md content

Create a \`HEARTBEAT.md\` file to guide the agent during heartbeats.`);

    return true;
  },
};

export const heartbeatCommands: CommandHandler[] = [heartbeatHandler];
