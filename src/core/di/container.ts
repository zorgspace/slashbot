/**
 * Dependency Injection - Container Configuration
 */

import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';

// Create the container with singleton scope by default
export const container = new Container({ defaultScope: 'Singleton' });

import { HooksManager } from '../utils/hooks';

container
  .bind(TYPES.HooksManager)
  .to(HooksManager)
  .inSingletonScope();

/**
 * Initialize the container with all services
 * Call this once at application startup
 */
export async function initializeContainer(options: { basePath?: string }): Promise<void> {
  const { basePath } = options;

  // Import and bind core services
  const { createConfigManager } = await import('../config/config');

  // Bind factories as dynamic values (they need to be initialized)
  container
    .bind(TYPES.ConfigManager)
    .toDynamicValue(() => createConfigManager())
    .inSingletonScope();

  // Bind composite services
  const { ConnectorRegistry } = await import('../../connectors/registry');
  const { CommandRegistry } = await import('../commands/registry');
  const { EventBus } = await import('../events/EventBus');

  // EventBus should be bound first as other services may depend on it
  container.bind(TYPES.EventBus).to(EventBus).inSingletonScope();

  container.bind(TYPES.ConnectorRegistry).to(ConnectorRegistry).inSingletonScope();

  // CommandRegistry starts empty - plugins contribute commands via getCommandContributions()
  container
    .bind(TYPES.CommandRegistry)
    .toDynamicValue(() => new CommandRegistry())
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
