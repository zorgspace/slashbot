/**
 * MCP Plugin - Load tools from external MCP servers
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser, unregisterActionParsersForTags } from '../../core/actions/parser';
import { TYPES } from '../../core/di/types';
import type { EventBus } from '../../core/events/EventBus';
import { MCPManager } from './manager';
import { createMCPParserConfig } from './parser';
import { executeMCPTool, setMCPManager } from './executors';
import { buildMCPPrompt } from './prompt';
import { mcpCommands, setMCPManagerForCommands } from './commands';

export class MCPPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.mcp',
    name: 'MCP',
    version: '1.0.0',
    category: 'feature',
    description: 'Model Context Protocol - load tools from external MCP servers',
  };

  private manager = new MCPManager();
  private actionContributions: ActionContribution[] = [];
  private eventBus?: EventBus;
  private registeredMCPTags: string[] = [];

  async init(context: PluginContext): Promise<void> {
    // Wire up the manager
    setMCPManager(this.manager);
    setMCPManagerForCommands(this.manager);

    // Get EventBus from DI
    try {
      this.eventBus = context.container.get(TYPES.EventBus) as EventBus;
    } catch {
      // EventBus not available
    }

    // Set up tool-changed callback to re-register parsers dynamically
    this.manager.onToolsChanged = () => {
      this.registerToolParsers();
      this.eventBus?.emit({ type: 'prompt:redraw' });
    };

    // Load config and connect to servers
    await this.manager.loadConfig();
    await this.manager.connectAll();

    // Register tool parsers for all discovered tools
    this.registerToolParsers();

    // Build action contributions for MCP tools
    this.actionContributions = [
      {
        type: 'mcp-tool',
        tagName: 'mcp-tool',
        handler: {},
        execute: executeMCPTool,
      },
    ];
  }

  private registerToolParsers(): void {
    // Unregister previously registered mcp-* parsers to prevent accumulation
    if (this.registeredMCPTags.length > 0) {
      unregisterActionParsersForTags(this.registeredMCPTags);
      this.registeredMCPTags = [];
    }

    const tools = this.manager.getAllTools();
    for (const tool of tools) {
      const parserConfig = createMCPParserConfig(tool.name, tool.serverName);
      registerActionParser(parserConfig);
      this.registeredMCPTags.push(...parserConfig.tags);
    }
  }

  async destroy(): Promise<void> {
    await this.manager.disconnectAll();
  }

  getActionContributions(): ActionContribution[] {
    return this.actionContributions;
  }

  getPromptContributions(): PromptContribution[] {
    const tools = this.manager.getAllTools();
    if (tools.length === 0) return [];

    return [
      {
        id: 'mcp',
        title: 'MCP Tools',
        priority: 25,
        content: () => buildMCPPrompt(this.manager.getAllTools()),
      },
    ];
  }

  getCommandContributions(): CommandHandler[] {
    return mcpCommands;
  }
}
