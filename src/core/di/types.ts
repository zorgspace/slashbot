/**
 * Dependency Injection - Service Tokens
 */

export const TYPES = {
  // Core services
  GrokClient: Symbol.for('GrokClient'),
  TaskScheduler: Symbol.for('TaskScheduler'),
  FileSystem: Symbol.for('FileSystem'),
  ConfigManager: Symbol.for('ConfigManager'),
  CodeEditor: Symbol.for('CodeEditor'),
  SkillManager: Symbol.for('SkillManager'),
  CommandPermissions: Symbol.for('CommandPermissions'),
  HeartbeatService: Symbol.for('HeartbeatService'),

  // Composite services
  ConnectorRegistry: Symbol.for('ConnectorRegistry'),
  CommandRegistry: Symbol.for('CommandRegistry'),

  // Event system
  EventBus: Symbol.for('EventBus'),

  // Plugin system
  PluginRegistry: Symbol.for('PluginRegistry'),
};
