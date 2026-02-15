export interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
  hint?: string;
}

export interface ToolAdapter {
  id: string;
  execute(args: string[]): Promise<ToolResult>;
}

export interface CommandContext {
  tools: {
    get: (id: string) => ToolAdapter | undefined;
    list: () => string[];
  };
}

export interface CommandDefinition {
  id: string;
  description: string;
  run: (ctx: CommandContext, args: string[]) => Promise<string>;
}

export interface PluginApi {
  registerCommand(command: CommandDefinition): void;
  registerTool(tool: ToolAdapter): void;
}

export interface InkPlugin {
  id: string;
  setup(api: PluginApi): void | Promise<void>;
}
