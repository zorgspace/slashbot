# Slashbot Getting Started

## 1. Install Dependencies

```bash
bun install
```

Slashbot requires Bun at runtime.

## 2. Configure Provider Credentials

Fast path from shell:

```bash
slashbot login <api_key>
```

Or run the in-app guided wizard:

```bash
bun run dev
```

Then inside Slashbot:

```text
/login
```

The wizard guides provider, key, and model selection.

## 3. Start Interactive Mode

```bash
bun run dev
```

Useful first commands:

- `/help`
- `/config`
- `/provider`
- `/model`

## 4. Run a Single Prompt (Non-Interactive)

```bash
bun run src/index.ts -m "Review docs/ROADMAP.md and summarize priorities."
```

## 5. Understand Config Locations

- `~/.slashbot/credentials.json`: shared secrets
- `~/.slashbot/config/config.json`: global defaults
- `./.slashbot/config/config.json`: project-level overrides
- `./.slashbot/plugins.settings.json`: plugin runtime toggles for this project
- `./settings.json`: optional plugin overrides under `plugins`

## 6. Connector Setup

- Telegram setup guide: `docs/channels/telegram.md`
- Discord setup guide: `docs/channels/discord.md`

## Troubleshooting

- `Slashbot requires Bun runtime`: install Bun and restart shell.
- `Not connected to Grok. Use /login`: run `/login` or `slashbot login <api_key>`.
- Connector configured but not running: restart Slashbot after connector config changes.
