/**
 * Automation prompt contribution
 */

export const AUTOMATION_PROMPT = [
  '## Automation Tools',
  '- Use automation tools to manage persistent cron/webhook jobs.',
  '- Use `automation_status` or `<automation-status/>` to inspect summary health before changes.',
  '- Use `automation_list` or `<automation-list/>` before mutating jobs.',
  '- Use `automation_add_cron` or `<automation-add-cron ...>prompt</automation-add-cron>` to schedule recurring jobs.',
  '- Use `automation_add_webhook` or `<automation-add-webhook ...>prompt</automation-add-webhook>` to bind jobs to gateway webhooks.',
  '- Use `automation_run` to execute one job immediately for validation.',
  '- Use `<automation-enable selector="..."/>` / `<automation-disable selector="..."/>` for temporary control.',
  '- Use `automation_remove` only when the user explicitly asks deletion.',
  '- For target delivery: `source=none` disables connector notifications; otherwise use connector id + optional target id.',
].join('\n');
