# Slashbot

CLI assistant powered by Grok with a plugin-based runtime, connector support (Telegram/Discord), and a TUI-first workflow.

## Requirements

- Bun runtime installed (`https://bun.sh`)
- At least one provider API key (`xAI`, `Anthropic`, `OpenAI`, or `Google`)

## Quick Start

1. Install dependencies:

```bash
bun install
```

2. Configure your API key:

```bash
slashbot login <api_key>
```

Or run interactive setup:

```bash
bun run dev
# then in slashbot:
/login
```

3. Start Slashbot:

```bash
bun run dev
```

## Non-Interactive Mode

Send one message and exit:

```bash
bun run src/index.ts -m "Summarize docs/ARCHITECTURE.md"
```

## Install as a Global Binary

Build and install `/usr/local/bin/slashbot`:

```bash
bun run install-global
```

## Common Commands

- `/login` guided provider + model setup
- `/logout` clear active API key
- `/config` show current provider/model and config location
- `/provider` switch between configured providers
- `/model` switch model for current provider
- `/telegram` configure Telegram connector
- `/discord` configure Discord connector
- `/automation` manage cron/webhook automation jobs
- `/help` show full command list

Gateway commands:

- `slashbot gateway start --host 127.0.0.1 --port 7788`
- `slashbot gateway status`
- `slashbot gateway pair --label my-client`
- `slashbot gateway stop`

## Configuration Files

- `~/.slashbot/credentials.json`: shared secrets (API keys, provider creds, connector tokens)
- `~/.slashbot/config/config.json`: global non-secret defaults
- `./.slashbot/config/config.json`: project-local non-secret overrides
- `./.slashbot/plugins.settings.json`: runtime plugin overrides per project
- `./settings.json`: optional project-level plugin overrides

## Quality Commands

```bash
bun run typecheck
bun run lint
# Optional strict lint pass (current tech debt surface)
bun run lint:full
bun run test
bun run build
```

## Documentation

- `docs/start/getting-started.md`
- `docs/channels/telegram.md`
- `docs/channels/discord.md`
- `docs/GATEWAY_AUTOMATION.md`
- `docs/plugins/README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
