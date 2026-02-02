/**
 * Dependency Injection - Container Configuration
 */

import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';

// Create the container with singleton scope by default
export const container = new Container({ defaultScope: 'Singleton' });

/**
 * Initialize the container with all services
 * Call this once at application startup
 */
export async function initializeContainer(options: { basePath?: string }): Promise<void> {
  const { basePath } = options;

  // Import and bind core services
  const { createConfigManager } = await import('../config/config');
  const { createFileSystem } = await import('../fs/filesystem');
  const { createScheduler } = await import('../scheduler/scheduler');
  const { createCodeEditor } = await import('../code/editor');
  const { createCommandPermissions } = await import('../security/permissions');
  const { createSkillManager } = await import('../skills/manager');

  // Bind factories as dynamic values (they need to be initialized)
  container
    .bind(TYPES.ConfigManager)
    .toDynamicValue(() => createConfigManager())
    .inSingletonScope();
  container
    .bind(TYPES.FileSystem)
    .toDynamicValue(() => createFileSystem(basePath))
    .inSingletonScope();
  container
    .bind(TYPES.TaskScheduler)
    .toDynamicValue(() => createScheduler())
    .inSingletonScope();
  container
    .bind(TYPES.CodeEditor)
    .toDynamicValue(() => createCodeEditor(basePath))
    .inSingletonScope();
  container
    .bind(TYPES.CommandPermissions)
    .toDynamicValue(() => createCommandPermissions())
    .inSingletonScope();
  container
    .bind(TYPES.SkillManager)
    .toDynamicValue(() => createSkillManager(basePath))
    .inSingletonScope();

  // Bind composite services
  const { ConnectorRegistry } = await import('../services/ConnectorRegistry');
  const { ActionHandlerService } = await import('../services/ActionHandlerService');
  const { CommandRegistry } = await import('../commands/registry');
  const { getAllHandlers, setCommandsRef } = await import('../commands/handlers');
  const { EventBus } = await import('../events/EventBus');

  // EventBus should be bound first as other services may depend on it
  container.bind(TYPES.EventBus).to(EventBus).inSingletonScope();

  container.bind(TYPES.ConnectorRegistry).to(ConnectorRegistry).inSingletonScope();
  container.bind(TYPES.ActionHandlerService).to(ActionHandlerService).inSingletonScope();

  // Bind and initialize CommandRegistry with all handlers
  container
    .bind(TYPES.CommandRegistry)
    .toDynamicValue(() => {
      const registry = new CommandRegistry();
      registry.registerAll(getAllHandlers());
      // Set reference for help command
      setCommandsRef(registry['commands']);
      return registry;
    })
    .inSingletonScope();
}

/**
 * Get a service from the container
 */
export function getService<T>(type: symbol): T {
  return container.get<T>(type);
}

// Re-export types
export { TYPES };
