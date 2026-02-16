# Slashbot

[![Node >=20](https://img.shields.io/badge/node-%3E=20-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Ink TUI](https://img.shields.io/badge/ink-TUI-orange.svg)](https://github.com/vadimdemedes/ink)

Local-first AI assistant platform with a small, extensible kernel, deterministic hooks, plugin-first runtime registration, and unified CLI/TUI/gateway surfaces.

Slashbot runs agents locally, letting them plan and execute using tools like `shell_exec`, `fs_read/write/patch`, `web_search/fetch`, `memory_search/upsert`, and more — in a bounded loop until goals are reached (e.g., build/tests pass).

The main agent is **agent-first**: macro-planning before direct execution in a single bounded loop.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20
- npm/yarn/pnpm/bun

### Clone & Install
```bash
git clone https://github.com/zorgspace/slashbot.git  # Or your fork
cd slashbot
npm install
```

### Build & Run TUI
```bash
npm run build
npm run dev  # Starts interactive TUI
```

Chat with Slashbot! Try: \"List skills\" or \"Run heartbeat\".

### Global Binary
```bash
npm link  # Or npm i -g .
slashbot  # Runs from anywhere
```

## 📋 Commands

| Script | Description |
|--------|-------------|
| `npm run dev` | Watch mode TUI/CLI |
| `npm run build` | TypeScript build |
| `npm test` | Run tests |
| `npm run lint` | Type check |

## ⚙️ Configuration

- **Global**: `~/.slashbot/config.json` (providers, API keys)
- **Workspace**: `<cwd>/.slashbot/config.json` (overrides)
- **HEARTBEAT.md**: Periodic status checks/updates

See [docs/architecture.md](docs/architecture.md) for hooks and layers.

## 🛠️ Features

- **Local-first**: Full control, no cloud required
- **Skills**: 50+ pre-installed (weather, github, discord, slack, notion, etc.)
  - List: `ls skills/`
  - Run: `skill_run \"weather\" \"What's the forecast?\"`
- **Agents**: Specialist sub-agents (`agents_list`, `agents_invoke`)
- **Tools**: Filesystem, shell, web, memory, messaging (Discord/Telegram/Slack/WhatsApp)
- **Connectors**: CLI, TUI (Ink), HTTP/WS gateway, chat apps
- **Heartbeat**: Auto system/workspace health checks
- **Memory**: Persistent context (`MEMORY.md`, daily notes)

## 📁 Skills

Purpose-built CLI tools orchestrated by agents:
- **Communication**: discord, slack, telegram, whatsapp, himalaya (email)
- **Productivity**: notion, obsidian, things-mac, apple-notes/reminders
- **Development**: github, coding-agent, ink-cli-plugin-architecture
- **Media**: openai-image-gen/whisper, nano-pdf/banana-pro, sonoscli/spotify-player
- **More**: 1password, gog (Google Workspace), local-places, ordercli/food-order

Install new: `skill_install https://github.com/user/skill.git`

## 🏗️ Architecture

[Full docs](docs/architecture.md):
- **Kernel**: Orchestration, hooks, agent loop
- **Plugins**: Extensible tools/skills/connectors
- **Providers**: Multi-LLM (OpenAI, Anthropic, Grok, etc.) via ai-sdk

## 🔄 Heartbeat

Runs periodically:
- System/workspace checks
- Moltbook integration (DMs, feed)
- Status reports to connectors

Configure: `heartbeat_configure`, trigger: `heartbeat_trigger`

## 🤝 Contributing

1. Fork & clone
2. `npm install && npm run dev`
3. Add skills/plugins in `skills/`
4. Test: `npm test`
5. PR!

New skills follow [SKILL.md](skills/skill-creator/SKILL.md) template.

## 📄 License

MIT (see LICENSE or add one).

---

⭐ Star on GitHub! Questions? Ask Slashbot directly.
