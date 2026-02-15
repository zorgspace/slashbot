/**
 * Node-RED Plugin - Prompt contribution
 *
 * LLM context for Node-RED managed process.
 * Follows BashPlugin prompt pattern (array of strings joined with \n).
 */

export const NODERED_PROMPT = [
  '## nodered -- Managed Node-RED Process',
  'Node-RED runs as a managed child process of slashbot.',
  '',
  '**Available commands:**',
  '- `/nodered start` — Start Node-RED',
  '- `/nodered stop` — Stop Node-RED',
  '- `/nodered restart` — Restart Node-RED',
  '- `/nodered status` — Check health and view recent logs',
  '- `/nodered config` — View or update configuration',
  '- Alias: `/nr` works for all subcommands',
  '',
  '**Important:**',
  '- DO NOT use `bash` to start, stop, or manage Node-RED — use `/nodered` commands instead',
  '- DO NOT modify Node-RED `settings.js` directly — it is auto-generated on each start',
  '- Use `/nodered status` to check health and view recent logs',
  '- Node-RED Editor is accessible at `http://localhost:{port}/` (default port: 1880)',
].join('\n');
