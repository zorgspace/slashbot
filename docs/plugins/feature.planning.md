# feature.planning

- Plugin ID: `feature.planning`
- Category: `feature`
- Purpose: two-phase planning flow (explore -> write plan file -> execute from clean context).

## User Commands

- No dedicated slash command.
- Triggered by planning-style prompts in CLI input (`input:before` kernel hook).

## Actions

- `plan-ready`

## Tools

- No dedicated AI SDK tools.

## Key Files

- `src/plugins/planning/index.ts`
- `src/plugins/planning/trigger.ts`
- `src/plugins/planning/executors.ts`
