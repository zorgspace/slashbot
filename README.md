# Slashbot

[![GitHub Repo stars](https://img.shields.io/github/stars/zorgspace/slashbot?style=social)](https://github.com/zorgspace/slashbot)
[![GitHub license](https://img.shields.io/github/license/zorgspace/slashbot)](https://github.com/zorgspace/slashbot/blob/master/LICENSE)
[![Bun](https://img.shields.io/badge/Bun-v1.0%2B-brightgreen?logo=bun)](https://bun.sh/)

Lightweight autonomous agentic AI for engineering, development & automation. Powered by xAI Grok with native tools, skills, Solana wallet & multi-platform support.

## Why Slashbot?

Slashbot is a fast, extensible alternative to Claude Code with unique features:

- **Agentic AI**: Autonomous task execution with persistent context and tool chaining.
- **Token Payments**: Pay for API usage with $SLASHBOT tokens on Solana - no API keys needed.
- **Multi-Platform**: CLI, Telegram, and Discord connectors.
- **Extensible Skills**: Load specialized capabilities like Docker, Solana trading, TUI building.
- **Built-in Wallet**: Manage Solana wallet directly in chat.
- **Heartbeat Monitoring**: Proactive AI reflection and notifications.

## Table of Contents

- [Why Slashbot?](#why-slashbot)
- [Changelog](#changelog)
- [Features](#features)
- [Documentation](#documentation)
- [Quick Start](#quick-start)
- [Payment Modes](#payment-modes)
- [Commands](#commands)
- [Plugins](#plugins)
- [Architecture](#architecture)
- [Development](#development)
- [Configuration](#configuration)
- [$SLASHBOT Token](#slashbot-token)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Roadmap](#roadmap)

## Changelog

### v2.0.0

- Enhanced extensibility & performance via feat/2.0.0 merge.
- Heartbeat: Use `$HOME_SLASHBOT_DIR` for workDir; remove redundant display.
- Build: Inline `--external` in `build.sh`.
- Docs: Plugin details & new links.
- UI: No background on DiffPanel for consistency.

[Full changelog](https://github.com/zorgspace/slashbot/commits/master)

## Features

- **AI-Powered CLI** - Conversational coding assistant with streaming responses, context persistence, and automatic tool use
- **Plugin Architecture** - 13 built-in core plugins + third-party GitHub/URL support:
  - **Bash**: Shell execution with timeouts, background jobs.
  - **Code-Editor**: Read/edit/write files, search/replace blocks, formatting.
  - **Explore**: Codebase discovery (quick/medium/deep/comprehensive).
  - **Filesystem**: ls, glob for file/dir navigation.
  - **Heartbeat**: Periodic self-reflection and monitoring.
  - **Planning**: Step-by-step autonomous task planning.
  - **Say**: Mid-task progress updates to user.
  - **Scheduling**: Cron jobs, notifications (e.g., Telegram).
  - **Session**: Persistent conversation context.
  - **Skills**: Load specialized capabilities (Docker, Solana, TUI, etc.).
  - **System**: Environment queries, status checks.
  - **Wallet**: Solana wallet (balance, send, status, tokens).
  - **Web**: URL fetch, web search, content extraction.
- **$SLASHBOT Token Payments** - Pay for API usage with $SLASHBOT SPL token on Solana (no direct API keys needed).
- **Multi-Platform Connectors**:
  - **CLI**: Rich OpenTUI REPL with streaming responses.
  - **Telegram**: Bot interface via Telegraf.
  - **Discord**: Server/channel bot via discord.js.
- **Advanced Code Tools** - Natural language control over: read/edit/write, glob/grep/explore, format (Prettier), typecheck (TypeScript), git ops (user-requested only).
- **Task Scheduling** - Cron-based job scheduling with persistent task management
- **Heartbeat System** - Periodic AI reflection for proactive monitoring and alerts
- **Skills** - Extensible capabilities (Docker, Solana, OpenTUI, Bags, Moltbook, and more)

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) - Deep technical overview
- [Roadmap](./docs/ROADMAP.md) - Future features
- [Token Utility](./docs/TOKEN_UTILITY.md) - $SLASHBOT economics

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- An X.AI API key **or** a funded $SLASHBOT wallet

### Install

```bash
git clone https://github.com/zorgspace/slashbot.git
cd slashbot
bun install

# Build and install globally
bun run install-global
```

### Setup

```bash
# Start slashbot
slashbot

# Configure your API key (direct mode)
/login

# Or configure wallet-based payment
/mode token
/wallet create
```

### Usage

Once running, just type naturally:

```
> read src/index.ts and explain the main loop
> find all TODO comments in the codebase
> create a new endpoint in src/api/routes.ts for user registration
> fix the type error in utils/parser.ts
```

## Payment Modes

| Mode                         | Description                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| **API Key** (`/mode apikey`) | Use your own X.AI API key directly. You pay xAI.                                   |
| **Token** (`/mode token`)    | Pay with $SLASHBOT tokens from your Solana wallet. Pricing is 2.5x xAI base rates. |

See [TOKEN_UTILITY.md](./docs/TOKEN_UTILITY.md) for full details on the token economy.

## Commands

| Command      | Description                                   |
| ------------ | --------------------------------------------- |
| `/help`      | Show all available commands                   |
| `/login`     | Configure API key                             |
| `/mode`      | Switch between apikey and token payment modes |
| `/wallet`    | Manage Solana wallet (create, import, export) |
| `/balance`   | Check wallet balance (SOL + $SLASHBOT)        |
| `/send`      | Send tokens to another address                |
| `/redeem`    | Redeem $SLASHBOT tokens for API credits       |
| `/pricing`   | Show current pricing and exchange rates       |
| `/usage`     | View token usage statistics                   |
| `/plan`      | Create a multi-step plan                      |
| `/tasks`     | List and manage scheduled tasks               |
| `/skill`     | Load or install a skill                       |
| `/telegram`  | Configure Telegram bot connector              |
| `/discord`   | Configure Discord bot connector               |
| `/heartbeat` | Configure periodic AI reflection              |
| `/clear`     | Clear conversation context                    |
| `/status`    | Show system status                            |

## Plugins

Slashbot is built on a plugin architecture. Every capability is a plugin:

| Plugin        | Category  | Description                                |
| ------------- | --------- | ------------------------------------------ |
| `bash`        | Core      | Shell command execution with safety guards |
| `filesystem`  | Core      | File read, write, edit, glob, grep, ls     |
| `code-editor` | Core      | Format, typecheck, auto-fix                |
| `web`         | Core      | Web fetch and search                       |
| `say`         | Core      | Console output and notifications           |
| `explore`     | Feature   | Codebase exploration and analysis          |
| `tasks`       | Feature   | Task creation and management               |
| `skills`      | Feature   | Skill loading and installation             |
| `scheduling`  | Feature   | Cron-based job scheduling                  |
| `heartbeat`   | Feature   | Periodic AI reflection and alerts          |
| `wallet`      | Feature   | Solana wallet and $SLASHBOT payments       |
| `telegram`    | Connector | Telegram bot integration                   |
| `discord`     | Connector | Discord bot integration                    |

Install third-party plugins:

```
/plugin install https://github.com/user/slashbot-plugin-example
```

See [PLUGIN_GUIDE.md](./docs/PLUGIN_GUIDE.md) for creating your own plugins.

## Architecture

```
src/
  index.ts              # Entry point, REPL loop
  api/                  # Grok API client, prompt assembly
  actions/              # XML action parsing and execution
  plugins/              # Plugin system (registry, loader, built-in plugins)
  commands/             # Slash command handling
  connectors/           # CLI, Telegram, Discord connectors
  services/             # Wallet, pricing, heartbeat, scheduler, skills
  di/                   # Dependency injection (InversifyJS)
  ui/                   # Terminal UI (colors, animations, input)
  code/                 # Code editor operations
  security/             # Permission system
  events/               # Event bus (pub/sub)
  config/               # Constants and configuration
```

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full technical overview.

## Development

```bash
# Run in development mode (hot reload)
bun run dev

# Type check
bun run typecheck

# Run tests
bun run test

# Run tests with coverage
bun run test:coverage

# Build production binary
bun run build
```

## Configuration

All user configuration is stored in `~/.slashbot/`:

```
~/.slashbot/
  config/config.json    # General settings (model, payment mode)
  credentials.json      # API keys (xAI, Telegram, Discord)
  wallet.json           # Encrypted Solana wallet
  wallet-config.json    # Proxy URL and wallet address
  permissions.json      # Command permissions
  heartbeat.json        # Heartbeat configuration
  skills/               # Installed custom skills
  tasks/                # Scheduled tasks
  context/              # Conversation dumps
  history               # Command history
```

## $SLASHBOT Token

| Property     | Value                                             |
| ------------ | ------------------------------------------------- |
| **Name**     | SLASHBOT                                          |
| **Chain**    | Solana                                            |
| **Mint**     | `AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS`    |
| **Standard** | SPL Token                                         |
| **Use**      | Pay for Grok API calls through the Slashbot proxy |

## Security

- Dangerous shell commands are blocked (rm /etc, fork bombs, disk writes to system dirs, privilege escalation)
- Git operations safe by default (no force-push, no destructive resets without consent)
- Wallet credentials encrypted with AES-256-GCM
- Passwords never logged or stored in plaintext
- Session-based wallet auth with 30-min timeout

## Community & Support

- Report issues: [GitHub Issues](https://github.com/zorgspace/slashbot/issues)
- Discussions: [GitHub Discussions](https://github.com/zorgspace/slashbot/discussions)
- Telegram: Configure via `/telegram` command
- Discord: Configure via `/discord` command

## Contributing

Contributions welcome!

1. [Fork the repo](https://github.com/zorgspace/slashbot/fork)
2. Create feature branch (`git checkout -b feat/amazing-feature`)
3. Commit (`git commit -m 'feat: add amazing feature'`)
4. Push (`git push origin feat/amazing-feature`)
5. [Open PR](https://github.com/zorgspace/slashbot/compare)

Ensure `bun test` passes. Use [conventional commits](https://www.conventionalcommits.org).

## License

MIT

## Roadmap

See [ROADMAP.md](./docs/ROADMAP.md) for the full project roadmap and vision.

---

[GitHub](https://github.com/zorgspace/slashbot) | [Docs](./docs/) | Made with ❤️ by Slashbin
