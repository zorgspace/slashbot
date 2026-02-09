/**
 * Plugin Command - List loaded plugins
 */

import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

export const pluginCommand: CommandHandler = {
  name: 'plugin',
  description: 'List loaded plugins',
  usage: '/plugin',
  aliases: ['plugins'],
  group: 'System',
  execute: async () => {
    const { TYPES } = require('../../../core/di/types');
    const { container } = require('../../../core/di/container');
    const registry = container.get(TYPES.PluginRegistry) as any;
    const allPlugins = registry.getAll();

    display.append('');
    display.violet('Plugins', { bold: true });
    display.append('');
    for (const meta of allPlugins) {
      display.append('  [OK] ' + meta.name + ' (' + meta.id + ' v' + meta.version + ')');
      display.muted('    ' + meta.description);
    }
    display.append('');

    return true;
  },
};
