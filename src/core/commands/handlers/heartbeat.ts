/**
 * Heartbeat Command - Manage the heartbeat system
 *
 * Commands:
 *   /heartbeat          - Trigger a heartbeat immediately
 *   /heartbeat status   - Show heartbeat status
 *   /heartbeat config   - Show current configuration
 *   /heartbeat every X  - Set heartbeat interval (e.g., "30m", "1h")
 *   /heartbeat target X - Set alert target (cli, telegram, discord, all, none)
 *   /heartbeat enable   - Enable heartbeat
 *   /heartbeat disable  - Disable heartbeat
 *   /heartbeat hours    - Set active hours (e.g., "08:00-22:00")
 */

import { c, colors } from '../../ui/colors';
import type { CommandHandler, CommandContext } from '../registry';
import { parseDuration, formatDuration } from '../../services/heartbeat';

export const heartbeatHandler: CommandHandler = {
  name: 'heartbeat',
  aliases: ['hb', 'pulse'],
  description: 'Manage heartbeat system - periodic AI reflection',
  usage: '/heartbeat [status|config|every|target|enable|disable|hours|now]',

  async execute(args: string[], context: CommandContext): Promise<boolean> {
    const { heartbeatService } = context;

    if (!heartbeatService) {
      console.log(c.error('Heartbeat service not available'));
      return true;
    }

    const subcommand = args[0]?.toLowerCase();

    // No args or "now" - trigger heartbeat immediately
    if (!subcommand || subcommand === 'now' || subcommand === 'trigger') {
      console.log(c.muted('\n  Triggering heartbeat...'));
      await heartbeatService.execute();
      return true;
    }

    // Status
    if (subcommand === 'status' || subcommand === 's') {
      const status = heartbeatService.getStatus();

      console.log('');
      console.log(`  ${c.bold('Heartbeat Status')}`);
      console.log('');
      console.log(`  ${c.muted('Running:')}    ${status.running ? c.success('Yes') : c.error('No')}`);
      console.log(`  ${c.muted('Enabled:')}    ${status.enabled ? c.success('Yes') : c.error('No')}`);
      console.log(`  ${c.muted('Interval:')}   ${status.interval}`);
      console.log(`  ${c.muted('Next run:')}   ${status.nextRun || 'N/A'}`);
      console.log(`  ${c.muted('Last run:')}   ${status.lastRun || 'Never'}`);
      console.log('');
      console.log(`  ${c.muted('Statistics:')}`);
      console.log(`    Total runs:      ${status.totalRuns}`);
      console.log(`    Total alerts:    ${status.totalAlerts}`);
      console.log(`    Consecutive OKs: ${status.consecutiveOks}`);
      console.log('');
      return true;
    }

    // Config
    if (subcommand === 'config' || subcommand === 'c') {
      const config = heartbeatService.getConfig();

      console.log('');
      console.log(`  ${c.bold('Heartbeat Configuration')}`);
      console.log('');
      console.log(`  ${c.muted('enabled:')}     ${config.enabled ?? true}`);
      console.log(`  ${c.muted('every:')}       ${config.every || '30m'}`);
      console.log(`  ${c.muted('target:')}      ${config.target || 'cli'}`);
      console.log(`  ${c.muted('ackMaxChars:')} ${config.ackMaxChars || 300}`);

      if (config.activeHours) {
        console.log(`  ${c.muted('activeHours:')} ${config.activeHours.start} - ${config.activeHours.end}`);
      }

      if (config.visibility) {
        console.log(`  ${c.muted('visibility:')}`);
        console.log(`    showOk:       ${config.visibility.showOk ?? false}`);
        console.log(`    showAlerts:   ${config.visibility.showAlerts ?? true}`);
        console.log(`    useIndicator: ${config.visibility.useIndicator ?? true}`);
      }

      console.log('');
      return true;
    }

    // Set interval
    if (subcommand === 'every' || subcommand === 'interval') {
      const interval = args[1];
      if (!interval) {
        console.log(c.error('Usage: /heartbeat every <interval>'));
        console.log(c.muted('  Examples: 30m, 1h, 2h30m'));
        return true;
      }

      const ms = parseDuration(interval);
      if (ms < 60000) {
        console.log(c.error('Minimum interval is 1 minute'));
        return true;
      }

      await heartbeatService.saveConfig({ every: interval });

      // Restart to apply new interval
      heartbeatService.stop();
      heartbeatService.start();

      console.log(c.success(`  Heartbeat interval set to ${formatDuration(ms)}`));
      return true;
    }

    // Set target
    if (subcommand === 'target') {
      const target = args[1]?.toLowerCase();
      const validTargets = ['cli', 'telegram', 'discord', 'all', 'none'];

      if (!target || !validTargets.includes(target)) {
        console.log(c.error('Usage: /heartbeat target <cli|telegram|discord|all|none>'));
        return true;
      }

      await heartbeatService.saveConfig({ target: target as any });
      console.log(c.success(`  Heartbeat target set to ${target}`));
      return true;
    }

    // Enable
    if (subcommand === 'enable' || subcommand === 'on') {
      await heartbeatService.saveConfig({ enabled: true });
      heartbeatService.start();
      console.log(c.success('  Heartbeat enabled'));
      return true;
    }

    // Disable
    if (subcommand === 'disable' || subcommand === 'off') {
      heartbeatService.stop();
      await heartbeatService.saveConfig({ enabled: false });
      console.log(c.success('  Heartbeat disabled'));
      return true;
    }

    // Set active hours
    if (subcommand === 'hours') {
      const range = args[1];
      if (!range) {
        // Clear active hours
        await heartbeatService.saveConfig({ activeHours: undefined });
        console.log(c.success('  Active hours cleared (heartbeat runs 24/7)'));
        return true;
      }

      const match = range.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!match) {
        console.log(c.error('Usage: /heartbeat hours <HH:MM-HH:MM>'));
        console.log(c.muted('  Example: /heartbeat hours 08:00-22:00'));
        console.log(c.muted('  Use /heartbeat hours (no args) to clear'));
        return true;
      }

      await heartbeatService.saveConfig({
        activeHours: { start: match[1], end: match[2] },
      });
      console.log(c.success(`  Active hours set to ${match[1]} - ${match[2]}`));
      return true;
    }

    // Show HEARTBEAT.md
    if (subcommand === 'md' || subcommand === 'checklist') {
      const content = await heartbeatService.readHeartbeatMd();
      if (content) {
        console.log('');
        console.log(`  ${c.bold('HEARTBEAT.md')}`);
        console.log('');
        console.log(content);
        console.log('');
      } else {
        console.log(c.muted('  No HEARTBEAT.md found in current directory'));
        console.log(c.muted('  Create one to guide the agent during heartbeats'));
      }
      return true;
    }

    // Unknown subcommand - show help
    console.log('');
    console.log(`  ${c.bold('Heartbeat Commands')}`);
    console.log('');
    console.log(`  ${colors.cyan}/heartbeat${colors.reset}              Trigger heartbeat now`);
    console.log(`  ${colors.cyan}/heartbeat status${colors.reset}       Show status and statistics`);
    console.log(`  ${colors.cyan}/heartbeat config${colors.reset}       Show current configuration`);
    console.log(`  ${colors.cyan}/heartbeat every 30m${colors.reset}    Set interval (30m, 1h, 2h30m)`);
    console.log(`  ${colors.cyan}/heartbeat target cli${colors.reset}   Set target (cli, telegram, discord, all, none)`);
    console.log(`  ${colors.cyan}/heartbeat enable${colors.reset}       Enable heartbeat`);
    console.log(`  ${colors.cyan}/heartbeat disable${colors.reset}      Disable heartbeat`);
    console.log(`  ${colors.cyan}/heartbeat hours 8:00-22:00${colors.reset}  Set active hours`);
    console.log(`  ${colors.cyan}/heartbeat md${colors.reset}           Show HEARTBEAT.md content`);
    console.log('');
    console.log(c.muted('  Create a HEARTBEAT.md file to guide the agent during heartbeats.'));
    console.log('');

    return true;
  },
};
