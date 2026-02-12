# feature.heartbeat

- Plugin ID: `feature.heartbeat`
- Category: `feature`
- Purpose: periodic reflection loop with configurable interval/hours and `HEARTBEAT.md` integration.

## User Commands

- `/heartbeat` (aliases: `/hb`, `/pulse`)
- `now`, `status`, `config`, `every`, `enable`, `disable`, `hours`, `md`

## Actions

- `heartbeat`, `heartbeat-update`

## Tools

- No dedicated AI SDK tools; action-driven execution.

## Key Files

- `src/plugins/heartbeat/index.ts`
- `src/plugins/heartbeat/commands.ts`
- `src/plugins/heartbeat/services/HeartbeatService.ts`
