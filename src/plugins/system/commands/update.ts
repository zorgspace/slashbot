/**
 * Update Command - Check for and install updates
 */

import { display } from '../../../core/ui';
import {
  checkForUpdate,
  checkUpdateAvailable,
  downloadAndInstall,
  getCurrentVersion,
} from '../../../core/app/updater';
import type { CommandHandler } from '../../../core/commands/registry';

export const updateCommand: CommandHandler = {
  name: 'update',
  description: 'Check for and install updates',
  usage: '/update [check|install]',
  aliases: ['upgrade'],
  group: 'System',
  subcommands: ['check', 'install'],
  execute: async args => {
    const subcommand = args[0] || 'check';

    switch (subcommand) {
      case 'check': {
        await checkForUpdate(false, false);
        break;
      }

      case 'install': {
        const { available, currentVersion, latestVersion, release } = await checkUpdateAvailable();

        if (!available || !release) {
          const version = await getCurrentVersion();
          display.successText('Already running the latest version (v' + version + ')');
          return true;
        }

        display.info('Update available: v' + currentVersion + ' -> v' + latestVersion);

        if (release.body) {
          const notes = release.body.split('\n').slice(0, 5).join('\n');
          display.muted('');
          display.muted('Release notes:');
          display.muted(notes);
          display.append('');
        }

        const success = await downloadAndInstall(release);

        if (success) {
          display.append('');
          display.violet('Please restart slashbot to use the new version.');
        }
        break;
      }

      default:
        display.errorText('Unknown subcommand: ' + subcommand);
        display.muted('Usage: /update [check|install]');
        display.muted('  check   - Check if an update is available (default)');
        display.muted('  install - Download and install the latest update');
        break;
    }

    return true;
  },
};
