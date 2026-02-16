/**
 * Node-RED settings.js Generator
 *
 * Generates a valid Node.js module.exports file for Node-RED's settings.js
 * from the plugin's NodeRedConfig.
 */

import type { NodeRedConfig } from '../types.js';

/**
 * Generate Node-RED settings.js file content from config.
 *
 * Returns a JavaScript string that can be evaluated as a Node.js module
 * (module.exports = { ... }).
 */
export function generateSettings(config: NodeRedConfig): string {
  const uiHost = config.localhostOnly ? 'localhost' : '0.0.0.0';
  const escapedUserDir = config.userDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `module.exports = {
  uiPort: ${config.port},
  uiHost: '${uiHost}',
  userDir: '${escapedUserDir}',
  flowFile: 'flows.json',
  httpAdminRoot: '/',
  httpNodeRoot: '/',
  functionGlobalContext: {},
  logging: {
    console: {
      level: 'info',
      metrics: false,
      audit: false
    }
  },
  editorTheme: {
    projects: {
      enabled: false
    }
  }
};`;
}
