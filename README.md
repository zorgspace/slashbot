# Slashbot

Lightweight CLI assistant powered by Grok API. A fast, extensible alternative to Claude Code with built-in Solana wallet, multi-platform connectors, and a plugin architecture.

## Features

- **AI-Powered CLI** - Conversational coding assistant with streaming responses, context persistence, and automatic tool use
- **Plugin Architecture** - 13 built-in plugins (filesystem, bash, web, code-editor, wallet, heartbeat, scheduling, etc.) with support for third-party plugins installed from GitHub
- **$SLASHBOT Token Payments** - Pay for API usage with the $SLASHBOT SPL token on Solana instead of managing API keys directly
- **Multi-Platform** - Works as a CLI tool, Telegram bot, or Discord bot simultaneously
- **Code Tools** - Read, write, edit, glob, grep, format, typecheck - all via natural language
- **Task Scheduling** - Cron-based job scheduling with persistent task management
- **Heartbeat System** - Periodic AI reflection for proactive monitoring and alerts
- **Skills** - Extensible capabilities (Docker, Solana, voice transcription, and more)

## Authors

- **Main Developer**: Slashbin

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

- Dangerous shell commands are blocked (rm /, fork bombs, disk writes, privilege escalation)
- Git operations are safe by default (no force-push, no destructive resets)
- Wallet credentials are encrypted with AES-256-GCM
- Passwords are never logged or stored in plaintext
- Session-based wallet auth with 30-minute timeout

## License

MIT

## Test

This is a test edit to verify the editing functionality.
