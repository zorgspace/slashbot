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

  // Composite services
  ActionHandlerService: Symbol.for('ActionHandlerService'),
  ConnectorRegistry: Symbol.for('ConnectorRegistry'),
  PlanManager: Symbol.for('PlanManager'),
  HistoryManager: Symbol.for('HistoryManager'),
  CommandRegistry: Symbol.for('CommandRegistry'),

  // Event system
  EventBus: Symbol.for('EventBus'),
};
