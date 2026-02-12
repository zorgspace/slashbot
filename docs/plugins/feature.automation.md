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

- XML action tags:
  - `<automation-status/>`
  - `<automation-list/>`
  - `<automation-add-cron name="..." expression="..." source="..." target_id="...">prompt</automation-add-cron>`
  - `<automation-add-webhook name="..." webhook="..." secret="..." source="..." target_id="...">prompt</automation-add-webhook>`
  - `<automation-run selector="..."/>`
  - `<automation-remove selector="..."/>`
  - `<automation-enable selector="..."/>`
  - `<automation-disable selector="..."/>`
- AI SDK tools:
  - `automation_status`
  - `automation_list`
  - `automation_add_cron`
  - `automation_add_webhook`
  - `automation_run`
  - `automation_remove`
  - `automation_enable`
  - `automation_disable`
- Prompt contribution:
  - `feature.automation.tools` (included in LLM context, `contextInject: true`)

## Key Files

- `src/plugins/automation/index.ts`
- `src/plugins/automation/commands.ts`
- `src/plugins/automation/parser.ts`
- `src/plugins/automation/executors.ts`
- `src/plugins/automation/tools.ts`
- `src/plugins/automation/prompt.ts`
- `src/plugins/automation/services/AutomationService.ts`
- Full protocol usage: `docs/GATEWAY_AUTOMATION.md`
