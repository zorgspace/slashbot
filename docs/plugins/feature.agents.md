# feature.agents

- Plugin ID: `feature.agents`
- Category: `feature`
- Purpose: multi-agent orchestration (profiles, delegation, tasks, tabs, verification).

## User Commands

- `/agent` (alias `/agents`) with subcommands including:
- `status`, `list`, `tasks`, `spawn`, `switch`, `send`, `verify`, `recall`, `prompt`, `rename`, `role`, `autopoll`, `enable`, `disable`, `delete`, `history`, `run`

## Actions

- `agent-status`, `agent-create`, `agent-update`, `agent-delete`, `agent-list`, `agent-tasks`, `agent-run`, `agent-send`, `agent-verify`, `agent-recall`

## Tools

- `agents_status`, `agents_list`, `agents_tasks`, `agents_create`, `agents_update`, `agents_delete`, `agents_run`, `agents_verify`, `agents_recall`

## Key Files

- `src/plugins/agents/index.ts`
- `src/plugins/agents/commands.ts`
- `src/plugins/agents/services/AgentOrchestratorService.ts`
