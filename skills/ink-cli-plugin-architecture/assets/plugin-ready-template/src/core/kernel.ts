import type {
  CommandContext,
  CommandDefinition,
  InkPlugin,
  PluginApi,
  ToolAdapter,
} from './contracts.js';

export class Kernel {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly tools = new Map<string, ToolAdapter>();

  private readonly api: PluginApi = {
    registerCommand: command => {
      if (this.commands.has(command.id)) {
        throw new Error(`Duplicate command id: ${command.id}`);
      }
      this.commands.set(command.id, command);
    },
    registerTool: tool => {
      if (this.tools.has(tool.id)) {
        throw new Error(`Duplicate tool id: ${tool.id}`);
      }
      this.tools.set(tool.id, tool);
    },
  };

  async loadPlugins(plugins: InkPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.setup(this.api);
    }
  }

  listCommands(): CommandDefinition[] {
    return [...this.commands.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async executeCommand(input: string): Promise<string> {
    const [id, ...args] = input.trim().split(/\s+/);
    if (!id) {
      return '';
    }

    const command = this.commands.get(id);
    if (!command) {
      return `Unknown command: ${id}`;
    }

    const context: CommandContext = {
      tools: {
        get: toolId => this.tools.get(toolId),
        list: () => [...this.tools.keys()].sort(),
      },
    };

    return command.run(context, args);
  }
}
