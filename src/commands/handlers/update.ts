/**
 * Update Command Handler - Check for and install updates
 */

import { c } from '../../ui/colors';
import {
  checkForUpdate,
  checkUpdateAvailable,
  downloadAndInstall,
  getCurrentVersion,
} from '../../updater';
import type { CommandHandler } from '../registry';

export const updateCommand: CommandHandler = {
  name: 'update',
  description: 'Check for and install updates',
  usage: '/update [check|install]',
  aliases: ['upgrade'],
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
          console.log(c.success(`Already running the latest version (v${version})`));
          return true;
        }

        console.log(c.info(`Update available: v${currentVersion} -> v${latestVersion}`));

        if (release.body) {
          const notes = release.body.split('\n').slice(0, 5).join('\n');
          console.log(c.muted('\nRelease notes:'));
          console.log(c.muted(notes));
          console.log();
        }

        const success = await downloadAndInstall(release);

        if (success) {
          console.log(c.violet('\nPlease restart slashbot to use the new version.'));
        }
        break;
      }

      default:
        console.log(c.error(`Unknown subcommand: ${subcommand}`));
        console.log(c.muted('Usage: /update [check|install]'));
        console.log(c.muted('  check   - Check if an update is available (default)'));
        console.log(c.muted('  install - Download and install the latest update'));
        break;
    }

    return true;
  },
};

export const updateHandlers: CommandHandler[] = [updateCommand];
