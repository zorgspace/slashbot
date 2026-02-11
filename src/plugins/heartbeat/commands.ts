/**
 * Heartbeat Commands
 */

import { display } from '../../core/ui';
import { fg, bold } from '@opentui/core';
import { theme } from '../../core/ui/theme';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import { parseDuration, formatDuration } from './services';
import type { HeartbeatService } from './services';

export const heartbeatHandler: CommandHandler = {
  name: 'heartbeat',
  aliases: ['hb', 'pulse'],
  description: 'Manage heartbeat system - periodic AI reflection',
  usage: '/heartbeat [status|config|period|enable|disable|hours|now]',
  group: 'Heartbeat',
  subcommands: ['now', 'status', 'config', 'period', 'enable', 'disable', 'hours', 'md'],

  async execute(args: string[], context: CommandContext): Promise<boolean> {
    let heartbeatService: HeartbeatService;
    try {
      heartbeatService = context.container.get<HeartbeatService>(TYPES.HeartbeatService);
    } catch {
      display.errorText('Heartbeat service not available');
      return true;
    }

    const subcommand = args[0]?.toLowerCase();

    // No args or "now" - trigger heartbeat immediately
    if (!subcommand || subcommand === 'now' || subcommand === 'trigger') {
      display.muted('');
      display.muted('  Triggering heartbeat...');
      await heartbeatService.execute({ silent: false });
      return true;
    }

    // Status
    if (subcommand === 'status' || subcommand === 's') {
      const status = heartbeatService.getStatus();

      const statusBlock = `${bold(fg(theme.accent)('  Heartbeat Status'))}

  Running:    ${status.running ? fg(theme.success)('Yes') : fg(theme.warning)('No')}
  Enabled:    ${status.enabled ? fg(theme.success)('Yes') : fg(theme.warning)('No')}
  Interval:   ${status.interval}
  Next run:   ${status.nextRun || 'N/A'}
  Last run:   ${status.lastRun || 'Never'}

${fg(theme.muted)('  Statistics:')}
    Total runs:      ${status.totalRuns}
    Total alerts:    ${status.totalAlerts}
    Consecutive OKs: ${status.consecutiveOks}
`;
      display.append(statusBlock);
      return true;
    }

    // Config
    if (subcommand === 'config' || subcommand === 'c') {
      const config = heartbeatService.getConfig();

      const configBlock = `${fg(bold(theme.accent)('  Heartbeat Configuration'))}

  enabled:     ${fg((config.enabled ?? true) ? theme.success : theme.warning)(String(config.enabled ?? true))}
  period:      ${fg(theme.muted)(config.period || '30m')}
  ackMaxChars: ${fg(theme.muted)(String(config.ackMaxChars || 300))}

${config.activeHours ? fg(theme.muted)('  activeHours: ' + config.activeHours.start + ' - ' + config.activeHours.end) + '\n' : ''}

${
  config.visibility
    ? `
  visibility:
    showOk:       ${fg((config.visibility.showOk ?? false) ? theme.success : theme.warning)((config.visibility.showOk ?? false).toString())}
    showAlerts:   ${fg((config.visibility.showAlerts ?? true) ? theme.success : theme.warning)((config.visibility.showAlerts ?? true).toString())}
    useIndicator: ${fg((config.visibility.useIndicator ?? true) ? theme.success : theme.warning)((config.visibility.useIndicator ?? true).toString())}
`
    : ''
}

`;
      display.append(configBlock);
      return true;
    }

    // Set interval
    if (subcommand === 'period' || subcommand === 'interval') {
      const interval = args[1];
      if (!interval) {
        display.errorText('Usage: /heartbeat period <interval>');
        display.muted('  Examples: 30m, 1h, 2h30m');
        return true;
      }

      const ms = parseDuration(interval);
      if (ms < 60000) {
        display.errorText('Minimum interval is 1 minute');
        return true;
      }

      await heartbeatService.saveConfig({ period: interval });

      // Restart to apply new interval
      heartbeatService.stop();
      heartbeatService.start();

      display.successText('  Heartbeat interval set to ' + formatDuration(ms));
      return true;
    }

    // Enable
    if (subcommand === 'enable' || subcommand === 'on') {
      await heartbeatService.saveConfig({ enabled: true });
      heartbeatService.start();
      display.successText('  Heartbeat enabled');
      return true;
    }

    // Disable
    if (subcommand === 'disable' || subcommand === 'off') {
      heartbeatService.stop();
      await heartbeatService.saveConfig({ enabled: false });
      display.successText('  Heartbeat disabled');
      return true;
    }

    // Set active hours
    if (subcommand === 'hours') {
      const range = args[1];
      if (!range) {
        // Clear active hours
        await heartbeatService.saveConfig({ activeHours: undefined });
        display.successText('  Active hours cleared (heartbeat runs 24/7)');
        return true;
      }

      const match = range.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!match) {
        display.errorText('Usage: /heartbeat hours <HH:MM-HH:MM>');
        display.muted('  Example: /heartbeat hours 08:00-22:00');
        display.muted('  Use /heartbeat hours (no args) to clear');
        return true;
      }

      await heartbeatService.saveConfig({
        activeHours: { start: match[1], end: match[2] },
      });
      display.successText('  Active hours set to ' + match[1] + ' - ' + match[2]);
      return true;
    }

    // Show HEARTBEAT.md
    if (subcommand === 'md' || subcommand === 'checklist') {
      const content = await heartbeatService.readHeartbeatMd();
      if (content) {
        display.append('');
        display.boldText('  HEARTBEAT.md');
        display.append('');
        display.append(content);
        display.append('');
      } else {
        display.muted('  No HEARTBEAT.md found in current directory');
        display.muted('  Create one to guide the agent during heartbeats');
      }
      return true;
    }

    // Unknown subcommand - show help
    const helpBlock = `${fg(bold(theme.accent)('  Heartbeat Commands '))}

  /heartbeat              ${fg(theme.muted)('Trigger heartbeat now')}
  /heartbeat status       ${fg(theme.muted)('Show status and statistics')}
  /heartbeat config       ${fg(theme.muted)('Show current configuration')}
  /heartbeat period 30m   ${fg(theme.muted)('Set interval (30m, 1h, 2h30m)')}
  /heartbeat enable       ${fg(theme.muted)('Enable heartbeat')}
  /heartbeat disable      ${fg(theme.muted)('Disable heartbeat')}
  /heartbeat hours 8:00-22:00  ${fg(theme.muted)('Set active hours')}
  /heartbeat md           ${fg(theme.muted)('Show HEARTBEAT.md content')}

${fg(theme.muted)('  Create a HEARTBEAT.md file to guide the agent during heartbeats.')}
`;
    display.append(helpBlock);

    return true;
  },
};

export const heartbeatCommands: CommandHandler[] = [heartbeatHandler];
