# feature.mcp

- Plugin ID: `feature.mcp`
- Category: `feature`
- Purpose: integrate external MCP servers and expose MCP tools to the runtime.

## User Commands

- `/mcp` with subcommands:
- `list`, `add`, `remove`, `restart`, `auth`, `logout`, `call`

## Actions

- `mcp-tool`

## Tools

- Dynamic MCP tools loaded from configured MCP servers.

## Key Files

- `src/plugins/mcp/index.ts`
- `src/plugins/mcp/commands.ts`
- `src/plugins/mcp/manager.ts`
- `src/plugins/mcp/executors.ts`
