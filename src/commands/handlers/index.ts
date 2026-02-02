/**
 * Command Handlers - Central export for all command handlers
 */

export * from './session';
export * from './system';
export * from './process';
export * from './connectors';
export * from './personality';
export * from './code';
export * from './tasks';
export * from './skills';
export * from './images';
export * from './init';
export * from './update';

import type { CommandHandler } from '../registry';
import { sessionHandlers } from './session';
import { systemHandlers, setCommandsRef } from './system';
import { processHandlers } from './process';
import { connectorHandlers } from './connectors';
import { personalityHandlers } from './personality';
import { codeHandlers } from './code';
import { taskHandlers } from './tasks';
import { skillHandlers } from './skills';
import { imageHandlers } from './images';
import { initHandlers } from './init';
import { updateHandlers } from './update';

/**
 * Get all command handlers
 */
export function getAllHandlers(): CommandHandler[] {
  return [
    ...sessionHandlers,
    ...systemHandlers,
    ...processHandlers,
    ...connectorHandlers,
    ...personalityHandlers,
    ...codeHandlers,
    ...taskHandlers,
    ...skillHandlers,
    ...imageHandlers,
    ...initHandlers,
    ...updateHandlers,
  ];
}

/**
 * Initialize handlers with registry reference (for help command)
 */
export { setCommandsRef };
