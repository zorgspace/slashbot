# feature.automation

- Plugin ID: `feature.automation`
- Category: `feature`
- Purpose: persistent cron/webhook automation jobs that can run prompts and optionally notify connectors.

## User Commands

- `/automation status`
- `/automation list`
- `/automation add-cron <name> <cron> <source|none> <target|-> <prompt...>`
- `/automation add-webhook <name> <webhook> <secret|none> <source|none> <target|-> <prompt...>`
- `/automation run <job-id|job-name>`
- `/automation remove <job-id|job-name>`
- `/automation enable <job-id|job-name>`
- `/automation disable <job-id|job-name>`

## Actions / Tools

- None (service + command plugin).

## Key Files

- `src/plugins/automation/index.ts`
- `src/plugins/automation/commands.ts`
- `src/plugins/automation/services/AutomationService.ts`
- Full protocol usage: `docs/GATEWAY_AUTOMATION.md`
