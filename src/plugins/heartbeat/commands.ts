/**
 * Heartbeat Commands
 */

import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { parseDuration, formatDuration } from './services';

export const heartbeatHandler: CommandHandler = {
  name: 'heartbeat',
  aliases: ['hb', 'pulse'],
  description: 'Manage heartbeat system - periodic AI reflection',
  usage: '/heartbeat [status|config|every|target|enable|disable|hours|now]',
  group: 'Heartbeat',

  async execute(args: string[], context: CommandContext): Promise<boolean> {
    const { heartbeatService } = context;

    if (!heartbeatService) {
      display.errorText('Heartbeat service not available');
      return true;
    }

    const subcommand = args[0]?.toLowerCase();

    // No args or "now" - trigger heartbeat immediately
    if (!subcommand || subcommand === 'now' || subcommand === 'trigger') {
      display.muted('');
      display.muted('  Triggering heartbeat...');
      await heartbeatService.execute();
      return true;
    }

    // Status
    if (subcommand === 'status' || subcommand === 's') {
      const status = heartbeatService.getStatus();

      display.append('');
      display.boldText('  Heartbeat Status');
      display.append('');
      display.append('  Running:    ' + (status.running ? 'Yes' : 'No'));
      display.append('  Enabled:    ' + (status.enabled ? 'Yes' : 'No'));
      display.append('  Interval:   ' + status.interval);
      display.append('  Next run:   ' + (status.nextRun || 'N/A'));
      display.append('  Last run:   ' + (status.lastRun || 'Never'));
      display.append('');
      display.muted('  Statistics:');
      display.append('    Total runs:      ' + status.totalRuns);
      display.append('    Total alerts:    ' + status.totalAlerts);
      display.append('    Consecutive OKs: ' + status.consecutiveOks);
      display.append('');
      return true;
    }

    // Config
    if (subcommand === 'config' || subcommand === 'c') {
      const config = heartbeatService.getConfig();

      display.append('');
      display.boldText('  Heartbeat Configuration');
      display.append('');
      display.muted('  enabled:     ' + (config.enabled ?? true));
      display.muted('  every:       ' + (config.every || '30m'));
      display.muted('  target:      ' + (config.target || 'cli'));
      display.muted('  ackMaxChars: ' + (config.ackMaxChars || 300));

      if (config.activeHours) {
        display.muted('  activeHours: ' + config.activeHours.start + ' - ' + config.activeHours.end);
      }

      if (config.visibility) {
        display.muted('  visibility:');
        display.append('    showOk:       ' + (config.visibility.showOk ?? false));
        display.append('    showAlerts:   ' + (config.visibility.showAlerts ?? true));
        display.append('    useIndicator: ' + (config.visibility.useIndicator ?? true));
      }

      display.append('');
      return true;
    }

    // Set interval
    if (subcommand === 'every' || subcommand === 'interval') {
      const interval = args[1];
      if (!interval) {
        display.errorText('Usage: /heartbeat every <interval>');
        display.muted('  Examples: 30m, 1h, 2h30m');
        return true;
      }

      const ms = parseDuration(interval);
      if (ms < 60000) {
        display.errorText('Minimum interval is 1 minute');
        return true;
      }

      await heartbeatService.saveConfig({ every: interval });

      // Restart to apply new interval
      heartbeatService.stop();
      heartbeatService.start();

      display.successText('  Heartbeat interval set to ' + formatDuration(ms));
      return true;
    }

    // Set target
    if (subcommand === 'target') {
      const target = args[1]?.toLowerCase();
      const validTargets = ['cli', 'telegram', 'discord', 'all', 'none'];

      if (!target || !validTargets.includes(target)) {
        display.errorText('Usage: /heartbeat target <cli|telegram|discord|all|none>');
        return true;
      }

      await heartbeatService.saveConfig({ target: target as any });
      display.successText('  Heartbeat target set to ' + target);
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
    display.append('');
    display.boldText('  Heartbeat Commands');
    display.append('');
    display.append('  /heartbeat              Trigger heartbeat now');
    display.append('  /heartbeat status       Show status and statistics');
    display.append('  /heartbeat config       Show current configuration');
    display.append('  /heartbeat every 30m    Set interval (30m, 1h, 2h30m)');
    display.append('  /heartbeat target cli   Set target (cli, telegram, discord, all, none)');
    display.append('  /heartbeat enable       Enable heartbeat');
    display.append('  /heartbeat disable      Disable heartbeat');
    display.append('  /heartbeat hours 8:00-22:00  Set active hours');
    display.append('  /heartbeat md           Show HEARTBEAT.md content');
    display.append('');
    display.muted('  Create a HEARTBEAT.md file to guide the agent during heartbeats.');
    display.append('');

    return true;
  },
};

export const heartbeatCommands: CommandHandler[] = [heartbeatHandler];
