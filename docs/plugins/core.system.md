# core.system

- Plugin ID: `core.system`
- Category: `core`
- Purpose: general runtime/system command set and permissions service wiring.

## User Commands

- `/help`, `/clear`, `/history`, `/exit`, `/banner`, `/connectors`
- Personality commands: `/normal`, `/sarcasm`, `/depressed`, `/unhinged`
- Utility commands: `/paste-image`, `/init`, `/update`, `/ps`, `/kill`, `/todo`, `/plugin`, `/prompt`, `/usage`

## Actions / Tools

- None (command and context plugin).

## Key Files

- `src/plugins/system/index.ts`
- `src/plugins/system/commands/index.ts`
- `src/plugins/system/services/CommandPermissions.ts`
