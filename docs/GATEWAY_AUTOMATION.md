# Gateway + Automation Documentation

This document covers everything implemented for:

- `SB-001` gateway mode CLI
- `SB-002` gateway runtime (WebSocket + HTTP + command bus)
- `SB-003` pairing/auth token flow
- `SB-008` automation plugin (cron + webhook jobs)
- `SB-009` webhook-triggered automation
- `SB-014` tests for gateway/auth/automation

## What Was Implemented

Gateway runtime:

- `slashbot gateway start|status|stop|pair|help`
- Headless daemon mode (`slashbot gateway daemon`) used internally by `start`
- WebSocket endpoint for command/control: `/ws`
- Health endpoint: `/health`
- Webhook endpoint: `/webhooks/:name`
- Auth subsystem with pairing codes + access tokens + token rotation
- Gateway process state files (`pid` + endpoint metadata)

Automation runtime:

- New `feature.automation` plugin
- New slash command: `/automation` (alias `/auto`)
- Cron jobs with persistence and minute-level scheduler
- Webhook-triggered jobs with optional HMAC SHA-256 signature verification
- Optional connector delivery target per job (`telegram`, `discord`, etc.)
- EventBus events for job lifecycle and webhook ingestion

## Files Added / Updated

Gateway:

- `src/core/gateway/protocol.ts`
- `src/core/gateway/auth.ts`
- `src/core/gateway/state.ts`
- `src/core/gateway/server.ts`
- `src/core/gateway/daemon.ts`
- `src/core/gateway/auth.test.ts`
- `src/core/gateway/server.test.ts`

Automation:

- `src/plugins/automation/index.ts`
- `src/plugins/automation/settings.json`
- `src/plugins/automation/commands.ts`
- `src/plugins/automation/types.ts`
- `src/plugins/automation/services/AutomationService.ts`
- `src/plugins/automation/services/AutomationService.test.ts`

Integration wiring:

- `src/index.ts`
- `src/core/app/cli.ts`
- `src/core/app/kernel.ts`
- `src/core/api/types.ts`
- `src/core/api/client.ts`
- `src/core/api/streaming.ts`
- `src/core/config/constants.ts`
- `src/core/di/types.ts`
- `src/plugins/loader.ts`

## Gateway CLI Usage (All Supported Modes)

Status:

```bash
slashbot gateway status
```

Start daemon:

```bash
slashbot gateway start
slashbot gateway start --host 127.0.0.1
slashbot gateway start --port 7788
slashbot gateway start --host 0.0.0.0 --port 9000
```

Stop daemon:

```bash
slashbot gateway stop
```

Generate pairing code:

```bash
slashbot gateway pair
slashbot gateway pair --label my-client
```

Help:

```bash
slashbot gateway help
```

Internal daemon entrypoint (normally called by `start`):

```bash
slashbot gateway daemon --host 127.0.0.1 --port 7788
```

## Gateway WebSocket Usage (All Message Types)

Connect:

- URL: `ws://<host>:<port>/ws`
- First server message is always:

```json
{
  "type": "hello",
  "version": "2.x.x",
  "authRequired": true,
  "serverTime": "..."
}
```

### Unauthenticated client messages

Authenticate with existing token:

```json
{ "type": "authenticate", "token": "sbgw_..." }
```

Pair with one-time pairing code:

```json
{ "type": "pair", "code": "SBPAIR-...", "label": "optional-label" }
```

Ping:

```json
{ "type": "ping", "ts": 1234567890 }
```

### Auth responses

On success:

```json
{
  "type": "auth_ok",
  "clientId": "client_...",
  "label": "gateway-client",
  "tokenIssuedAt": "..."
}
```

On error:

```json
{ "type": "auth_error", "message": "..." }
```

When pairing succeeds, server also sends:

```json
{
  "type": "pairing_code",
  "code": "sbgw_...",
  "expiresAt": ""
}
```

Note: in this message `code` is the newly issued token.

### Authenticated command envelope

All commands use:

```json
{
  "type": "command",
  "id": "unique-client-command-id",
  "name": "message.send | sessions.list | status.get | auth.rotate | ping",
  "payload": {}
}
```

Server acknowledges receipt:

```json
{ "type": "command_ack", "id": "..." }
```

Command completion:

```json
{
  "type": "command_result",
  "id": "...",
  "ok": true,
  "result": {}
}
```

On failure:

```json
{
  "type": "command_result",
  "id": "...",
  "ok": false,
  "error": "..."
}
```

### Supported command names and payloads

`ping`:

```json
{
  "type": "command",
  "id": "c1",
  "name": "ping"
}
```

`status.get`:

```json
{
  "type": "command",
  "id": "c2",
  "name": "status.get"
}
```

`sessions.list`:

```json
{
  "type": "command",
  "id": "c3",
  "name": "sessions.list"
}
```

`auth.rotate`:

```json
{
  "type": "command",
  "id": "c4",
  "name": "auth.rotate"
}
```

`message.send`:

```json
{
  "type": "command",
  "id": "c5",
  "name": "message.send",
  "payload": {
    "sessionId": "gateway:my-client",
    "message": "Analyze src/core/app/kernel.ts"
  }
}
```

`message.send` emits progress events:

- `command_event` with `event: "started"`
- `command_event` with `event: "chunk"` and `data.chunk` (zero or more)
- `command_event` with `event: "completed"` and `data.sessionId`

### Broadcast events

Authenticated sockets receive every EventBus event as:

```json
{
  "type": "event",
  "name": "event-name",
  "payload": { "...": "..." },
  "ts": "..."
}
```

## Gateway HTTP Usage

Health check:

```bash
curl http://127.0.0.1:7788/health
```

Webhook ingestion:

```bash
curl -X POST http://127.0.0.1:7788/webhooks/deploy \
  -H "content-type: application/json" \
  -d '{"commit":"abc123"}'
```

Response:

```json
{
  "accepted": true,
  "webhook": "deploy",
  "matchedJobs": 1
}
```

## Automation Command Usage (All Supported Modes)

Command aliases:

- `/automation ...`
- `/auto ...`

Status:

```text
/automation status
```

List:

```text
/automation list
/automation ls
```

Add cron job:

```text
/automation add-cron <name> <cron> <source|none> <target|-> <prompt...>
```

Examples:

```text
/automation add-cron daily-summary "0 9 * * *" telegram 12345 summarize repo status
/automation add-cron ci-check "@hourly" none - check failing tests
```

Add webhook job:

```text
/automation add-webhook <name> <webhook> <secret|none> <source|none> <target|-> <prompt...>
```

Examples:

```text
/automation add-webhook deploy-alert deploy mysecret telegram 12345 summarize deployment payload
/automation add-webhook audit-hook audit none none - summarize webhook payload
```

Run immediately:

```text
/automation run <job-id|job-name>
```

Remove:

```text
/automation remove <job-id|job-name>
/automation rm <job-id|job-name>
/automation delete <job-id|job-name>
```

Enable/disable:

```text
/automation enable <job-id|job-name>
/automation disable <job-id|job-name>
```

## Cron Syntax Supported

Supported expression shape:

- 5 fields: `minute hour day-of-month month day-of-week`
- Numeric values only, with ranges and steps

Supported constructs per field:

- `*`
- `n`
- `a-b`
- `*/n`
- `a-b/n`
- comma lists: `1,2,5-10/2`

Field ranges:

- minute: `0-59`
- hour: `0-23`
- day-of-month: `1-31`
- month: `1-12`
- day-of-week: `0-7` (where `7` maps to `0`, Sunday)

Supported aliases:

- `@hourly`
- `@daily`
- `@weekly`
- `@monthly`

## Webhook Signature Verification

For webhook jobs with a `secret`, request signature is required.

Accepted headers:

- `x-slashbot-signature`
- `x-signature`
- `x-hub-signature-256`

Accepted formats:

- raw hex digest
- `sha256=<hex>`

Digest algorithm:

- `HMAC-SHA256(secret, rawBody)` (hex output)

Unsigned or invalidly signed requests do not trigger secret-protected jobs.

## Persistence Files

Gateway files:

- `./.slashbot/gateway/gateway.pid`
- `./.slashbot/gateway/gateway-state.json`
- `./.slashbot/gateway/gateway-auth.json`

Automation files:

- `./.slashbot/automation-jobs.json`

## Auth Model Details

- Pairing codes have prefix `SBPAIR-`.
- Access tokens have prefix `sbgw_`.
- Default pairing TTL is 10 minutes.
- Minimum pairing TTL is 30 seconds.
- Token store keeps at most 64 active tokens.

## EventBus Events Emitted

Automation events:

- `automation:job:started`
- `automation:job:completed`
- `automation:job:error`
- `automation:webhook:received`

Gateway webhook bridge event:

- `gateway:webhook`

These are plugin events (string events) and are streamed to authenticated gateway WebSocket clients.

## Test Coverage Added

New tests:

- `src/core/gateway/auth.test.ts`
- `src/core/gateway/server.test.ts`
- `src/plugins/automation/services/AutomationService.test.ts`

Run targeted tests:

```bash
bunx vitest run \
  src/core/gateway/auth.test.ts \
  src/core/gateway/server.test.ts \
  src/plugins/automation/services/AutomationService.test.ts
```

Run full suite:

```bash
bun run typecheck
bun run test
```

Note:

- `src/core/gateway/server.test.ts` is Bun-runtime specific and is skipped when Bun runtime APIs are unavailable in the test environment.

## Gateway Capability Matrix (Code-Accurate)

| Area | Capability | Interface | Source |
| --- | --- | --- | --- |
| Process lifecycle | Start gateway daemon with host/port flags | `slashbot gateway start --host ... --port ...` | `src/core/gateway/daemon.ts` |
| Process lifecycle | Stop daemon with graceful `SIGTERM` and fallback `SIGKILL` | `slashbot gateway stop` | `src/core/gateway/daemon.ts`, `src/core/gateway/state.ts` |
| Process lifecycle | Inspect runtime status + endpoint + auth summary | `slashbot gateway status` | `src/core/gateway/daemon.ts` |
| Auth bootstrap | Generate one-time pairing code with optional label | `slashbot gateway pair --label my-client` | `src/core/gateway/daemon.ts`, `src/core/gateway/auth.ts` |
| State persistence | Persist PID + runtime endpoint metadata | `./.slashbot/gateway/gateway.pid`, `gateway-state.json` | `src/core/gateway/state.ts` |
| Auth persistence | Persist hashed pairing codes and hashed tokens | `./.slashbot/gateway/gateway-auth.json` | `src/core/gateway/auth.ts` |
| WebSocket transport | Command/control socket | `ws://<host>:<port>/ws` | `src/core/gateway/server.ts` |
| WebSocket handshake | Server hello on connect | `{ "type":"hello", ... }` | `src/core/gateway/server.ts` |
| Unauthenticated auth | Authenticate with existing token | `{ "type":"authenticate","token":"sbgw_..." }` | `src/core/gateway/server.ts` |
| Unauthenticated auth | Pair with one-time code and receive token | `{ "type":"pair","code":"SBPAIR-..." }` | `src/core/gateway/server.ts`, `src/core/gateway/auth.ts` |
| Keepalive | Ping/pong before and after auth | client `{ "type":"ping" }`, server `{ "type":"pong" }` | `src/core/gateway/server.ts` |
| Command bus | Ack every command ID | `{ "type":"command_ack","id":"..." }` | `src/core/gateway/server.ts` |
| Command bus | Gateway liveness ping command | command name `ping` | `src/core/gateway/server.ts`, `src/core/gateway/protocol.ts` |
| Command bus | Runtime status query (model/provider/connectors) | command name `status.get` | `src/core/gateway/server.ts`, `src/core/app/kernel.ts` |
| Command bus | Session summary query | command name `sessions.list` | `src/core/gateway/server.ts`, `src/core/app/kernel.ts` |
| Command bus | Rotate current auth token | command name `auth.rotate` | `src/core/gateway/server.ts`, `src/core/gateway/auth.ts` |
| Command bus | Send message into Slashbot gateway session | command name `message.send` | `src/core/gateway/server.ts`, `src/core/app/kernel.ts` |
| Streaming responses | Incremental message chunks for `message.send` | `command_event: started/chunk/completed` | `src/core/gateway/server.ts` |
| Error semantics | Structured command failure and unsupported command handling | `{ "type":"command_result","ok":false,"error":"..." }` | `src/core/gateway/server.ts` |
| Event streaming | Broadcast all EventBus events to authenticated sockets | `{ "type":"event","name":"...","payload":... }` | `src/core/gateway/server.ts` |
| HTTP health | Service heartbeat endpoint | `GET /health` | `src/core/gateway/server.ts` |
| HTTP webhook ingress | Receive arbitrary webhook payloads | `POST /webhooks/:name` | `src/core/gateway/server.ts` |
| Automation bridge | Route gateway webhook payloads into automation job matcher | `handleGatewayWebhook(...)` | `src/core/app/kernel.ts`, `src/plugins/automation/services/AutomationService.ts` |
| Webhook security | Optional HMAC signature validation for webhook jobs | headers `x-slashbot-signature` / `x-signature` / `x-hub-signature-256` | `src/plugins/automation/services/AutomationService.ts` |
| Session model | Per-client default session namespace | `gateway:<client-id>` | `src/core/gateway/server.ts`, `src/core/app/kernel.ts` |

## Implementation Examples (Markdown, Ready to Copy)

### 1) Pair + send message over WebSocket (Node.js + `ws`)

```ts
import WebSocket from 'ws';

const GATEWAY_WS = 'ws://127.0.0.1:7788/ws';
const PAIR_CODE = process.env.SB_GATEWAY_PAIR_CODE!; // e.g. SBPAIR-ABCDEF1234

const ws = new WebSocket(GATEWAY_WS);

ws.on('open', () => {
  console.log('connected');
});

ws.on('message', raw => {
  const msg = JSON.parse(raw.toString());
  console.log('<=', msg);

  if (msg.type === 'hello') {
    ws.send(JSON.stringify({ type: 'pair', code: PAIR_CODE, label: 'ci-agent' }));
    return;
  }

  if (msg.type === 'pairing_code') {
    // Persist this token securely for future "authenticate" calls.
    console.log('new token:', msg.code);
    return;
  }

  if (msg.type === 'auth_ok') {
    ws.send(
      JSON.stringify({
        type: 'command',
        id: 'cmd-1',
        name: 'message.send',
        payload: {
          message: 'Summarize current status and blockers.',
        },
      }),
    );
    return;
  }

  if (msg.type === 'command_event' && msg.id === 'cmd-1' && msg.event === 'chunk') {
    process.stdout.write(msg.data?.chunk || '');
    return;
  }

  if (msg.type === 'command_result' && msg.id === 'cmd-1') {
    console.log('\nresult:', msg);
    ws.close();
  }
});
```

### 2) Reconnect with stored token + rotate token

```ts
import { readFileSync, writeFileSync } from 'fs';
import WebSocket from 'ws';

const tokenPath = '.gateway-token.txt';
const token = readFileSync(tokenPath, 'utf8').trim();
const ws = new WebSocket('ws://127.0.0.1:7788/ws');

ws.on('message', raw => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'hello') {
    ws.send(JSON.stringify({ type: 'authenticate', token }));
    return;
  }
  if (msg.type === 'auth_ok') {
    ws.send(
      JSON.stringify({
        type: 'command',
        id: 'rotate-1',
        name: 'auth.rotate',
      }),
    );
    return;
  }
  if (msg.type === 'command_result' && msg.id === 'rotate-1' && msg.ok) {
    writeFileSync(tokenPath, `${msg.result.token}\n`, 'utf8');
    ws.close();
  }
});
```

### 3) Query gateway status + visible sessions

```json
{ "type": "command", "id": "status-1", "name": "status.get" }
{ "type": "command", "id": "sessions-1", "name": "sessions.list" }
```

Expected `status.get` result shape:

```json
{
  "connected": true,
  "model": "grok-4-fast-reasoning",
  "provider": "xai",
  "connectors": [
    { "id": "telegram", "configured": true, "running": true }
  ]
}
```

### 4) Send signed webhook for an automation job (HMAC SHA-256)

```ts
import { createHmac } from 'crypto';

const webhookUrl = 'http://127.0.0.1:7788/webhooks/deploy';
const secret = process.env.WEBHOOK_SECRET!;
const body = JSON.stringify({ release: '2026.02.12', status: 'succeeded' });
const signature = createHmac('sha256', secret).update(body).digest('hex');

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-slashbot-signature': signature,
  },
  body,
});

console.log(await response.json()); // { accepted: true, webhook: "deploy", matchedJobs: N }
```

### 5) End-to-end webhook automation setup

```text
/automation add-webhook deploy-alert deploy mysecret telegram 1007767240 summarize deployment payload and risks
```

Then call:

```bash
curl -X POST http://127.0.0.1:7788/webhooks/deploy \
  -H "content-type: application/json" \
  -H "x-slashbot-signature: <hmac-hex>" \
  -d '{"service":"api","env":"prod","status":"ok"}'
```

You should receive:

- HTTP `202` from gateway
- `matchedJobs > 0` in response
- Automation lifecycle events on EventBus / authenticated gateway sockets
