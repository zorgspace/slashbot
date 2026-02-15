# Plugin and Tool Architecture for Ink CLIs

## Scope

Use this reference to keep Ink apps extensible without coupling UI, command logic, and shell integrations.

## Target Architecture

Use a layered architecture:

1. `UI layer` (`src/app.tsx`, `src/ui/*`): Render state and collect input.
2. `Kernel layer` (`src/core/*`): Register plugins, commands, tools.
3. `Plugin layer` (`src/plugins/*`): Declare features using kernel APIs.
4. `Tool layer` (`src/tools/*`): Encapsulate side effects and external binaries.

## Contracts

Use explicit contracts to prevent hidden coupling.

```ts
export interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
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
```

## Lifecycle

1. Load built-in tools.
2. Load plugins.
3. Validate duplicate ids and fail plugin-only registration.
4. Start Ink render.
5. Dispatch commands through kernel.
6. Shutdown cleanly and release tool resources.

## Plugin Loading Strategies

Use one strategy per project stage:

- Static loading: Import plugins directly for small codebases.
- Manifest loading: Resolve plugin package names from `package.json` field.
- Directory loading: Load local plugins from `src/plugins/*` for monorepos.

## Tool Adapter Rules

- Never invoke child processes from React components.
- Normalize stderr/stdout and return structured errors.
- Add timeout and cancellation support for long commands.
- Detect missing binaries and return actionable hints.

## Failure Isolation

- Catch plugin setup failures and continue boot when possible.
- Mark failed plugins as disabled in UI diagnostics.
- Keep core commands (`help`, `version`, `doctor`) available.

## Testing Strategy

- Unit-test kernel registration and conflict handling.
- Unit-test each command handler with mocked adapters.
- Integration-test keyboard flows with `ink-testing-library`.
- Snapshot-test non-interactive render output.
