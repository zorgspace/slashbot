# Plugin Reference

This folder documents every built-in plugin currently shipped with Slashbot.

## Connectors

- [connector.discord](./connector.discord.md)
- [connector.telegram](./connector.telegram.md)

## Core Plugins

- [core.bash](./core.bash.md)
- [core.code-editor](./core.code-editor.md)
- [core.filesystem](./core.filesystem.md)
- [core.git](./core.git.md)
- [core.prompt](./core.prompt.md)
- [core.providers](./core.providers.md)
- [core.say](./core.say.md)
- [core.session](./core.session.md)
- [core.system](./core.system.md)
- [core.tui](./core.tui.md)
- [core.web](./core.web.md)

## Feature Plugins

- [feature.agents](./feature.agents.md)
- [feature.automation](./feature.automation.md)
- [feature.heartbeat](./feature.heartbeat.md)
- [feature.mcp](./feature.mcp.md)
- [feature.memory](./feature.memory.md)
- [feature.planning](./feature.planning.md)
- [feature.question](./feature.question.md)
- [feature.skills](./feature.skills.md)
- [feature.todo](./feature.todo.md)
- [feature.transcription](./feature.transcription.md)
- [feature.wallet](./feature.wallet.md)

## Notes

- Commands are slash commands available in interactive mode.
- Actions are XML actions produced/parsed by the agent loop.
- Tools are native AI SDK tools registered in `ToolRegistry`.
- Connector plugins also provide commands and connector runtime handlers.
