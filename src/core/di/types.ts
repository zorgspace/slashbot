/**
 * Dependency Injection - Service Tokens
 */

export const TYPES = {
  // Core services
  GrokClient: Symbol.for('GrokClient'),
  LLMClient: Symbol.for('GrokClient'), // Alias pointing to same symbol
  ProviderRegistry: Symbol.for('ProviderRegistry'),
  TaskScheduler: Symbol.for('TaskScheduler'),
  FileSystem: Symbol.for('FileSystem'),
  ConfigManager: Symbol.for('ConfigManager'),
  CodeEditor: Symbol.for('CodeEditor'),
  SkillManager: Symbol.for('SkillManager'),
  CommandPermissions: Symbol.for('CommandPermissions'),
  HeartbeatService: Symbol.for('HeartbeatService'),
  AgentOrchestratorService: Symbol.for('AgentOrchestratorService'),

  // Composite services
  ConnectorRegistry: Symbol.for('ConnectorRegistry'),
  CommandRegistry: Symbol.for('CommandRegistry'),

  // Event system
  EventBus: Symbol.for('EventBus'),

  // Plugin-registered services
  ProcessManager: Symbol.for('ProcessManager'),
  ImageBuffer: Symbol.for('ImageBuffer'),

  // Plugin system
  PluginRegistry: Symbol.for('PluginRegistry'),
  HooksManager: Symbol.for('HooksManager'),
  ToolRegistry: Symbol.for('ToolRegistry'),
};
