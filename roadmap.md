# Slashbot Implementation Backlog

Backlog generated from the `openclaw` vs `slashbot` gap analysis.

## Prioritized backlog

| ID | Priority | Deliverable | Main files | DoD / Acceptance criteria | Size |
| --- | --- | --- | --- | --- | --- |
| SB-001 | P0 | Add gateway mode CLI (`start`, `status`, `stop`) | `src/index.ts`, `src/core/app/cli.ts`, `src/core/config/constants.ts` | `slashbot gateway start` runs headless without TTY, writes PID/status file, and cleanly stops | M |
| SB-002 | P0 | Create gateway runtime (WebSocket + command bus) | `src/core/gateway/server.ts` (new), `src/core/gateway/protocol.ts` (new), `src/core/app/kernel.ts` | Remote client can send message to session and receive streamed events | L |
| SB-003 | P0 | Pairing/auth for gateway clients | `src/core/gateway/auth.ts` (new), `src/core/config/config.ts`, `src/plugins/system/commands` | One-time pairing token flow, token rotation, unauthorized client rejected | M |
| SB-004 | P0 | Slack connector config + catalog plumbing | `src/connectors/base.ts`, `src/connectors/catalog.ts`, `src/core/config/config.ts`, `src/connectors/locks.ts` | `/connectors` shows Slack, config persists, lock manager supports Slack | M |
| SB-005 | P0 | Slack connector plugin/runtime | `src/connectors/slack/plugin.ts` (new), `src/connectors/slack/connector.ts` (new), `src/connectors/slack/commands.ts` (new), `src/plugins/loader.ts` | Slack bot receives/sends in channel + thread, supports authorized channel list | L |
| SB-006 | P0 | Unified ACL/trust policy across connectors | `src/connectors/telegram/plugin.ts`, `src/connectors/discord/plugin.ts`, `src/connectors/slack/plugin.ts`, `src/connectors/registry.ts` | Unauthorized chat/channel/user never reaches agent loop; audit event emitted | M |
| SB-007 | P1 | Replace missing `/task` and `/notify` with real command set | `src/plugins/system/commands/index.ts`, `src/plugins/system/commands/system.ts`, `src/core/app/cli.ts` | Help text and real commands are aligned; no dead/stale command docs | S |
| SB-008 | P1 | Automation engine (cron + named jobs + target connector) | `src/plugins/automation/index.ts` (new), `src/plugins/automation/services` (new), `src/core/config/constants.ts` | Can create/list/delete jobs, persisted in `.slashbot`, jobs survive restart | L |
| SB-009 | P1 | Webhook trigger support for automation jobs | `src/core/gateway/server.ts`, `src/plugins/automation` | Signed webhook endpoint triggers job with payload context | M |
| SB-010 | P1 | Plugin management UX (`/plugin install/remove/reload/info`) | `src/plugins/system/commands/plugin.ts`, `src/plugins/loader.ts`, `src/plugins/registry.ts` | Install/remove/reload works at runtime with clear errors and status | M |
| SB-011 | P1 | Plugin hot reload + filesystem watch | `src/plugins/registry.ts`, `src/plugins/loader.ts`, `src/core/app/kernel.ts` | Editing enabled plugin reloads without full app restart | M |
| SB-012 | P1 | Plugin template scaffolder | `scripts/create-plugin.ts` (new), `docs/PLUGIN_GUIDE.md` (new), `package.json` | `slashbot plugin init my-plugin` creates working template + tests | S |
| SB-013 | P1 | `slashbot doctor` diagnostics | `src/plugins/system/commands` (new command), `src/core/config/config.ts`, `src/connectors/registry.ts` | Checks provider keys, connector auth, permissions, plugin load health | M |
| SB-014 | P1 | Integration tests for connectors + gateway | `vitest.config.ts`, `src/connectors/*.test.ts` (new), `src/core/gateway/*.test.ts` (new) | CI runs connector smoke + gateway auth/session tests | L |
| SB-015 | P2 | Minimal web dashboard (sessions/connectors/jobs) | `apps/web` (new), `src/core/gateway/server.ts` | Read-only dashboard: live connector status + session list + job status | L |
| SB-016 | P2 | Voice I/O baseline plugin | `src/plugins/voice` (new), `src/plugins/transcription` | Push-to-talk input and spoken output in CLI with provider fallback | M |

## Recommended implementation order

1. SB-001 -> SB-002 -> SB-003
2. SB-004 -> SB-005 -> SB-006
3. SB-007 -> SB-008 -> SB-009
4. SB-010 -> SB-011 -> SB-012
5. SB-013 -> SB-014
6. SB-015 and SB-016
