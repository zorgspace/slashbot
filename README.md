# Slashbot

**Local-first AI assistant with a plugin-first architecture.**

Slashbot is a self-hosted, extensible AI agent platform that runs in your terminal. It connects to 19+ LLM providers, integrates with Telegram, Discord, Slack, and WhatsApp, and exposes a full agentic toolkit for file operations, shell execution, web browsing, multi-agent orchestration, and more.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Modes](#usage-modes)
- [LLM Providers](#llm-providers)
- [Plugins](#plugins)
  - [Agentic Tools](#agentic-tools)
  - [Messaging Integrations](#messaging-integrations)
  - [Multi-Agent System](#multi-agent-system)
  - [Orchestrator](#orchestrator)
  - [Automation](#automation)
  - [Heartbeat](#heartbeat)
  - [Memory](#memory)
  - [Skills](#skills)
  - [Web Tools](#web-tools)
  - [Transcription](#transcription)
  - [Wallet](#wallet)
  - [System Prompt](#system-prompt)
- [Gateway API](#gateway-api)
- [Configuration](#configuration)
- [Workspace Files](#workspace-files)
- [Plugin Development](#plugin-development)
- [Development](#development)

---

## Features

- **19 LLM providers** — Anthropic, OpenAI, xAI, Google, Mistral, DeepSeek, Groq, Ollama, and more
- **Interactive TUI** — Ink/React terminal interface with live agent activity, command palette, image paste
- **Multi-platform connectors** — Telegram, Discord, Slack, WhatsApp with per-chat sessions
- **Full agentic toolkit** — shell execution, file read/write/patch, directory listing, message sending, subagent spawning
- **Multi-agent orchestration** — named agents, teams, auto-routing, fan-out, pipeline strategies
- **Cron automation** — scheduled tasks with cron, webhook, timer, and one-shot triggers
- **Persistent memory** — markdown-based memory store with full-text search
- **Skills system** — extensible markdown-format skills from bundled, global, or workspace sources
- **Heartbeat monitoring** — periodic LLM-driven checks with alerting and delivery
- **Web search & fetch** — AI-powered web search via OpenAI or xAI, HTTP fetch with HTML stripping
- **Voice transcription** — OpenAI Whisper integration across all connectors
- **Solana wallet** — encrypted wallet with SOL/SPL transfers, credit redemption, token-mode proxy
- **Gateway server** — HTTP + WebSocket JSON-RPC API with auth
- **Plugin architecture** — dependency-sorted loading, lifecycle hooks, event bus, extensible via external plugins
- **Cross-platform binaries** — compile to standalone executables for Linux, macOS, and Windows

---

## Installation

### Prerequisites

- **Node.js** >= 20 or **Bun** runtime

### From source

```bash
git clone https://github.com/zorgspace/slashbot.git
cd slashbot
npm install
npm run build
npm link     # makes `slashbot` available globally
```

### Compile standalone binary

```bash
# Build for all platforms
npm run package

# Or install directly to ~/.local/bin/
npm run install-global
```

---

## Quick Start

```bash
# Launch the interactive TUI
slashbot

# On first run, the setup wizard will guide you through
# configuring an LLM provider and API key.
# You can also run it manually:
slashbot setup
```

Once configured, start chatting. The agent can execute shell commands, read/write files, search the web, and use any registered tool.

---

## Usage Modes

### Interactive TUI (default)

```bash
slashbot
# or
slashbot tui
```

Full-featured terminal UI with:
- Chat input with history and tab completion
- Live agent activity display (tool calls, thoughts, summaries)
- Command palette (`/` prefix)
- Status indicators for active connectors
- Image paste from clipboard

### Headless execution

```bash
slashbot run --prompt "List all TODO comments in this project"
```

Runs a single prompt through the full agentic pipeline and exits.

### Gateway server

```bash
slashbot gateway start
```

Starts an HTTP + WebSocket server for programmatic access (default `127.0.0.1:7680`).

### Slash commands

```bash
slashbot health          # Kernel health check
slashbot help            # List commands and tools
slashbot plugins list    # List loaded plugins
slashbot telegram status # Connector status
slashbot skill list      # List available skills
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--non-interactive` | Headless mode (no TUI) |
| `--gateway-token <token>` | Override gateway auth token |
| `--config-path <path>` | Override config file path |
| `--session-id <id>` | Use a specific session ID |
| `--agent-id <id>` | Use a specific agent ID |

---

## LLM Providers

Slashbot supports 19 providers through the Vercel AI SDK:

| Provider | Examples |
|----------|----------|
| **Anthropic** | Claude 4.5, Claude 4, Claude 3.5 |
| **OpenAI** | GPT-5, GPT-4o, o1, o3 |
| **xAI** | Grok-4, Grok-3 |
| **Google** | Gemini 2.5, Gemini 2.0 |
| **Mistral** | Mistral Large, Medium, Small |
| **DeepSeek** | DeepSeek-V3, R1 |
| **Groq** | Llama, Mixtral (fast inference) |
| **Ollama** | Any locally hosted model |
| **vLLM** | Any locally hosted model |
| **Amazon Bedrock** | Claude, Titan, Llama via AWS |
| **Azure OpenAI** | GPT models via Azure |
| **Google Vertex AI** | Gemini via GCP |
| **Together AI** | Open-source models |
| **Fireworks AI** | Open-source models |
| **DeepInfra** | Open-source models |
| **Cerebras** | Fast inference |
| **Cohere** | Command models |
| **Perplexity** | Search-augmented models |
| **Vercel AI Gateway** | Unified gateway to all providers |

### Managing providers

```bash
slashbot setup                 # First-time setup wizard
slashbot providers             # List configured providers
slashbot model                 # Switch active model
```

Auth profiles are stored in `~/.slashbot/` and support API key, OAuth PKCE, setup token, and Claude Code credential import.

---

## Plugins

Slashbot is built entirely on plugins. Every capability — from shell execution to Telegram integration — is a plugin.

### Agentic Tools

Core tools available to the LLM agent:

| Tool | Description |
|------|-------------|
| `shell.exec` | Execute shell commands with safety gating |
| `fs.read` | Read file contents |
| `fs.write` | Create or overwrite files |
| `fs.patch` | Find-and-replace in files |
| `fs.append` | Append to files |
| `fs.list` | List directory contents |
| `message` | Send messages to any registered channel |
| `spawn` | Spawn background subagents |

**Shell safety**: Dangerous commands (`rm -rf /`, `mkfs`, `shutdown`, etc.) are hard-blocked. Risky commands (`rm -r`, `git push --force`, `git reset --hard`, etc.) require explicit approval.

### Messaging Integrations

#### Telegram

```bash
slashbot telegram setup        # Configure bot token
slashbot telegram status       # Check connection status
slashbot telegram chatid       # Authorize a private chat
slashbot telegram groupchatid  # Authorize a group chat
```

- Full Telegraf-based bot with authorized chat allowlisting
- Text, photo, and voice message support (voice transcription via Whisper)
- Per-chat agent sessions with preemptive message queue
- Open/closed response gate modes
- Webhook support: `POST /telegram/webhook`

**Tools:** `telegram.status`, `telegram.send`, `telegram.add_chat`, `telegram.remove_chat`

#### Discord

```bash
slashbot discord setup <token>  # Configure bot token
slashbot discord status         # Check connection status
slashbot discord channel        # Manage authorized channels
```

- Full discord.js bot with channel allowlisting
- Text, image, and voice attachment support
- Separate sessions for guild channels and DMs
- Primary channel configuration for default outbound messages
- Webhook support: `POST /discord/webhook`

**Tools:** `discord.status`, `discord.send`, `discord.add_channel`, `discord.remove_channel`, `discord.set_primary`

#### Slack

```bash
slashbot slack setup            # Configure bot + app tokens
slashbot slack status           # Check connection status
```

- Bolt Socket Mode connector (no public URL required)
- Thread-aware replies with bot mention stripping
- Image and voice file support
- `@agent` routing within Slack messages
- Reaction feedback (eyes on receive, checkmark on success)
- Events API support: `POST /slack/events`

**Tools:** `slack.status`, `slack.send`, `slack.add_user`, `slack.remove_user`

#### WhatsApp

```bash
slashbot whatsapp setup         # Configure bridge URL
slashbot whatsapp status        # Check connection status
```

- WebSocket bridge connector (requires external bridge like whatsapp-web.js or Baileys)
- Phone number allowlisting
- Voice transcription support
- Auto-reconnect with exponential backoff

**Tools:** `whatsapp.status`, `whatsapp.send`

#### Common connector features

All connectors share:
- Per-chat persistent sessions with history
- Preemptive queue — new messages abort pending LLM calls
- `@agent-id` routing to named agents
- Status indicators in the TUI header bar
- Process locking to prevent duplicate instances

### Multi-Agent System

Register named agents with custom personas, models, and tool restrictions:

```bash
slashbot agents list             # List registered agents
slashbot agents register         # Register a new agent
slashbot agents teams            # Manage agent teams
```

**Tools:**

| Tool | Description |
|------|-------------|
| `agents.register` | Create an agent with custom system prompt, provider, model, and tool allowlist |
| `agents.invoke` | Run a named agent with a full agentic loop |
| `agents.list` | List all registered agents |
| `agents.remove` | Remove an agent |
| `agents.team.register` | Create a team with a leader and members |
| `agents.team.remove` | Remove a team |

**Routing:** Use `@agent-id message` in any connector to route to a specific agent.

**Teams:** A team has a leader agent that coordinates member agents. Route to a team with `@team-id`.

Agent definitions are persisted to `~/.slashbot/agents.json` and `~/.slashbot/teams.json`.

### Orchestrator

Intelligent multi-agent task delegation with three strategies:

| Strategy | Description |
|----------|-------------|
| `auto` | LLM-based routing to the best matching agent |
| `fan-out` | Run task across all agents in parallel |
| `pipeline` | Sequential chain — each agent receives the previous agent's output |

```
orchestrate task="Analyze this codebase" strategy=auto
orchestrate task="Translate to 5 languages" strategy=fan-out agents=["fr","es","de","ja","zh"]
orchestrate task="Draft then review" strategy=pipeline agents=["writer","reviewer"]
```

- Background execution with `background: true` (returns a `runId`)
- Run tracking: status (pending/running/completed/error/killed), duration, outcomes
- Kill runs by ID, label, numeric index, or `"all"`
- Max 8 concurrent orchestration runs (configurable)

### Automation

Schedule tasks with cron expressions, webhooks, timers, or one-shot delays:

| Tool | Description |
|------|-------------|
| `automation.add_cron` | Schedule recurring tasks (`0 9 * * *`, `@daily`, `@hourly`, etc.) |
| `automation.add_webhook` | Trigger tasks via HTTP POST with optional HMAC-SHA256 |
| `automation.add_timer` | Repeating interval-based tasks |
| `automation.add_once` | One-shot delayed tasks |
| `automation.list` | List all automation jobs |
| `automation.run` | Execute a job immediately |
| `automation.remove` | Remove a job |
| `automation.add_delivery` | Deliver job results to a channel |

- Webhook endpoint: `POST /automation/webhook/:name`
- Each job runs the prompt through the full LLM + tools agentic pipeline
- Delivery to any registered channel (Telegram, Discord, Slack, WhatsApp)
- Jobs persisted to `.slashbot/automation.json`

### Heartbeat

Periodic LLM-driven monitoring and alerting:

```bash
slashbot heartbeat enable            # Enable heartbeat
slashbot heartbeat every 30m         # Set interval (30m, 1h, 60s, etc.)
slashbot heartbeat prompt "..."      # Set custom review prompt
slashbot heartbeat deliver telegram  # Deliver alerts to Telegram
slashbot heartbeat trigger           # Trigger manually
slashbot heartbeat status            # View status and stats
```

- Reads `.slashbot/HEARTBEAT.md` as the checklist for each run
- LLM classifies results as `[OK]`, `[WARNING]`, or `[ALERT]`
- Alerts delivered to configured channels
- State tracking: total runs, alert count, last result

**Tools:** `heartbeat.trigger`, `heartbeat.update`, `heartbeat.status`, `heartbeat.configure`

### Memory

Persistent markdown-based knowledge store:

| Tool | Description |
|------|-------------|
| `memory.upsert` | Store a fact, decision, or preference |
| `memory.search` | Full-text search across all memory files |
| `memory.get` | Read a specific memory file (with optional line range) |
| `memory.note` | Write a daily note (organized by `YYYYMM/YYYYMMDD.md`) |
| `memory.stats` | Storage statistics |

- Main memory file: `.slashbot/MEMORY.md` (auto-injected into system prompt)
- Memory directory: `.slashbot/memory/`
- Daily notes organized by month

### Skills

Extensible markdown-format instructions that teach the agent new capabilities:

```bash
slashbot skill list                  # List available skills
slashbot skill info <name>           # View skill details
slashbot skill run <name>            # Execute a skill
```

**Skill format:** Markdown files with YAML frontmatter:
```yaml
---
description: "What this skill does"
slashbot:
  emoji: "🔧"
  primaryEnv: API_KEY_NAME
  os: [linux, macos]
  requires:
    bins: [curl, jq]
    anyBins: [python3, python]
    env: [GITHUB_TOKEN]
    config: [some.config.key]
---
# Skill instructions here...
```

**Resolution order:** workspace (`.slashbot/skills/`) > global (`~/.skills/`) > bundled (`skills/`)

**Install from GitHub:**
```
skill.install url="https://github.com/user/my-skill"
```

**Prerequisite checking:** Skills declare required binaries, environment variables, and config keys. Slashbot verifies these before running.

### Web Tools

| Tool | Description |
|------|-------------|
| `web.fetch` | Fetch any URL — strips HTML, pretty-prints JSON, truncates at 15K chars |
| `web.search` | AI-powered web search via OpenAI (GPT-5) or xAI (Grok) with relevance verdict |

Web search auto-selects the provider based on your active auth profile and returns a `USEFUL`/`NOT_USEFUL` verdict.

### Transcription

OpenAI Whisper-powered audio-to-text:

```bash
slashbot transcription setup <api-key>  # Configure API key
slashbot transcription status            # Check status
```

- Supports buffer and URL-based transcription
- Used automatically by Telegram, Discord, Slack, and WhatsApp connectors for voice messages
- Formats: OGG, MP3, WAV, M4A, WebM, OPUS

### Wallet

Solana wallet with encrypted key storage and payment integration:

```bash
slashbot solana create <password>  # Create new wallet
slashbot solana import             # Import existing wallet (seed phrase or private key)
slashbot solana export             # Export wallet
slashbot solana balance            # Check SOL/token balance
slashbot solana send               # Send SOL or tokens
slashbot solana deposit            # Show deposit address
slashbot solana pricing            # View token exchange rates
slashbot solana mode               # Switch payment mode (apikey/token)
slashbot solana redeem             # Redeem SLASHBOT tokens for API credits
slashbot solana unlock             # Unlock wallet session
slashbot solana lock               # Lock wallet
slashbot solana status             # Wallet status
```

- **Encryption:** AES-256-GCM with PBKDF2 key derivation
- **Session unlock:** 30-minute sessions with Ed25519 signed headers
- **Token support:** SOL and SLASHBOT SPL token
- **Exchange rates:** CoinGecko (SOL/USD), Jupiter/DexScreener (SLASHBOT/SOL), 60-second cache
- **Token mode:** Sign LLM requests with wallet key to use via proxy — no direct API key needed
- **Credit redemption:** Redeem SLASHBOT tokens for API credits

**Tools:** `wallet.status`, `wallet.send` (requires approval), `wallet.redeem` (requires approval)

### System Prompt

The system prompt plugin assembles the LLM context from multiple sources:

- **Base prompt** — core agent directives, tool use rules, quality gates
- **Tool catalog** — dynamic list of all registered tools with parameters
- **Workspace context** — system info (OS, shell, Node version), workspace file tree (depth 3), project-specific files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`)
- **Plugin contributions** — each plugin can contribute prompt sections and context providers
- **Available skills** — lists eligible skills for the agent

On startup, the workspace `.slashbot/` directory is initialized with template files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`, plus `memory/`, `plans/`, `hooks/`, and `skills/` directories.

---

## Gateway API

Start the gateway server:

```bash
slashbot gateway start
```

**Default:** `http://127.0.0.1:7680`

### Authentication

All endpoints (except `/health`) require:
```
Authorization: Bearer <gateway.authToken>
```

### REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Kernel health (unauthenticated) |
| `POST` | `/rpc` | JSON-RPC dispatch |
| `POST` | `/telegram/webhook` | Telegram bot webhook |
| `POST` | `/discord/webhook` | Discord bot webhook |
| `POST` | `/slack/events` | Slack Events API (with URL verification) |
| `POST` | `/automation/webhook/:name` | Automation trigger |

### WebSocket

Connect with `Authorization: Bearer <token>` header. Send JSON-RPC messages and receive real-time events from the kernel event bus.

### JSON-RPC methods

- `core.health` — health check
- `telegram.send` — send Telegram message
- `discord.send` — send Discord message
- `slack.send` — send Slack message

---

## Configuration

### Config files

Configs are deep-merged in order (later wins):

| Path | Scope |
|------|-------|
| Built-in defaults | Base |
| `~/.slashbot/config.json` | User-global |
| `./.slashbot/config.json` | Workspace-local |

### Config schema

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 7680,
    "authToken": "your-token"
  },
  "plugins": {
    "allow": ["plugin-id"],
    "deny": ["plugin-id"],
    "entries": [],
    "paths": []
  },
  "providers": {
    "active": {
      "providerId": "anthropic",
      "modelId": "claude-sonnet-4-20250514",
      "apiKey": "sk-..."
    }
  },
  "hooks": {
    "defaultTimeoutMs": 5000,
    "rules": {}
  },
  "logging": {
    "level": "info"
  },
  "skills": {
    "allowBundled": true,
    "bundledAllowlist": [],
    "entries": []
  }
}
```

### Persistent data files

| File | Description |
|------|-------------|
| `~/.slashbot/providers.json` | Provider overrides |
| `~/.slashbot/wallet.json` | Encrypted Solana wallet |
| `~/.slashbot/wallet-settings.json` | Payment mode settings |
| `~/.slashbot/telegram.json` | Telegram connector config |
| `~/.slashbot/discord.json` | Discord connector config |
| `~/.slashbot/slack.json` | Slack connector config |
| `~/.slashbot/whatsapp.json` | WhatsApp connector config |
| `~/.slashbot/transcription.json` | Transcription API key |
| `~/.slashbot/heartbeat.json` | Heartbeat config |
| `~/.slashbot/automation.json` | Scheduled automation jobs |
| `~/.slashbot/agents.json` | Registered agents |
| `~/.slashbot/teams.json` | Agent teams |
| `~/.slashbot/history` | CLI input history |

### Environment variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack app token (`xapp-...`) |
| `WHATSAPP_BRIDGE_URL` | WhatsApp WebSocket bridge URL |
| `OPENAI_API_KEY` | OpenAI key (transcription, web search) |
| `XAI_API_KEY` | xAI/Grok API key |
| `SOLANA_RPC_URL` | Solana RPC endpoint (default: mainnet) |
| `SLASHBOT_AUTO_UPDATE` | Set to `0` or `false` to disable auto-update |

---

## Workspace Files

On first run in a directory, Slashbot initializes a `.slashbot/` workspace:

| File/Dir | Purpose |
|----------|---------|
| `AGENTS.md` | Agent operating instructions and behavior directives |
| `SOUL.md` | Agent persona, tone, and character definition |
| `TOOLS.md` | Project-specific tool usage notes |
| `MEMORY.md` | Persistent project memory (auto-injected into system prompt) |
| `HEARTBEAT.md` | Heartbeat monitoring checklist |
| `memory/` | Memory file storage (daily notes, topic files) |
| `plans/` | Planning documents |
| `hooks/` | Custom hook scripts |
| `skills/` | Workspace-scoped skills |
| `config.json` | Workspace-local configuration override |
| `automation.json` | Scheduled automation jobs |

---

## Plugin Development

External plugins implement the `SlashbotPlugin` interface:

```typescript
import type { SlashbotPlugin, PluginRegistrationContext } from '@slashbot/plugin-sdk';

const plugin: SlashbotPlugin = {
  manifest: {
    id: 'my.custom.plugin',
    name: 'My Plugin',
    version: '1.0.0',
    dependencies: [],
    priority: 100,
  },

  async setup(context: PluginRegistrationContext) {
    // Register tools
    context.registerTool({
      name: 'my_tool',
      description: 'Does something useful',
      pluginId: 'my.custom.plugin',
      parameters: { type: 'object', properties: {} },
      execute: async (args) => ({ forLlm: 'Result', forUser: 'Result' }),
    });

    // Register commands
    context.registerCommand({
      name: 'mycommand',
      description: 'My slash command',
      pluginId: 'my.custom.plugin',
      execute: async (args, kernel) => 'Command output',
    });

    // Register hooks
    context.registerHook({
      domain: 'lifecycle',
      event: 'message_received',
      pluginId: 'my.custom.plugin',
      handler: async (payload) => payload,
    });

    // Contribute to system prompt
    context.contributePromptSection({
      id: 'my-section',
      pluginId: 'my.custom.plugin',
      priority: 50,
      render: () => 'Additional context for the LLM',
    });
  },
};

export function createPlugin() { return plugin; }
```

### Installing external plugins

Place plugins in `~/.slashbot/plugins/<name>/` with a `manifest.json`, or install from GitHub:

```bash
slashbot plugins install https://github.com/user/slashbot-plugin-example
```

### Plugin capabilities

Plugins can register:
- **Tools** — exposed to the LLM agent during agentic execution
- **Commands** — `/command` slash commands in TUI and CLI
- **Hooks** — lifecycle, kernel, and custom event handlers
- **Providers** — LLM provider definitions with models and auth
- **Gateway methods** — JSON-RPC handlers
- **HTTP routes** — custom REST endpoints
- **Services** — shared singleton services accessible by other plugins
- **Channels** — messaging destinations (used by the `message` tool)
- **Prompt sections** — static system prompt fragments
- **Context providers** — dynamic system prompt data
- **Status indicators** — TUI header bar indicators

### Lifecycle hooks

| Domain | Events |
|--------|--------|
| **Kernel** | `startup`, `input`, `render`, `tabs`, `sidebar`, `shutdown` |
| **Lifecycle** | `before_agent_start`, `agent_end`, `before_compaction`, `after_compaction`, `message_received`, `message_sending`, `message_sent`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `session_start`, `session_end`, `gateway_start`, `gateway_stop`, `before_command`, `after_command`, `before_prompt_assemble`, `after_prompt_assemble`, `before_llm_call`, `after_llm_call`, `cli_init`, `cli_exit` |
| **Custom** | Any plugin-defined event name |

### Config-driven hooks

Hooks can also be declared in `config.json` as shell commands:

```json
{
  "hooks": {
    "rules": {
      "PreToolUse": [{
        "matcher": "shell.exec",
        "hooks": [{ "type": "command", "command": "echo 'shell about to execute'" }]
      }],
      "PostToolUse": [],
      "Startup": [],
      "Shutdown": []
    }
  }
}
```

---

## Development

```bash
npm install          # Install dependencies
npm run build        # TypeScript build
npm run dev          # Run TUI with bun
npm test             # Run tests (vitest)
npm run lint         # Type check
npm run package      # Build cross-platform binaries
```

### Architecture

```
src/
├── index.ts                  # Entry point
├── core/
│   ├── kernel/               # Kernel, registries, event bus, hooks, config
│   ├── agentic/              # LLM adapter interface, tool bridge
│   ├── voltagent/            # VoltAgent-based agent runtime
│   └── gateway/              # HTTP + WebSocket server
├── ui/
│   ├── cli.ts                # CLI router
│   ├── tui.tsx               # Main TUI component (Ink/React)
│   ├── header-bar.tsx        # Status indicator bar
│   ├── input-row.tsx         # Chat input
│   ├── agent-activity.tsx    # Live tool execution display
│   ├── command-palette.tsx   # /command autocomplete
│   └── ...
├── plugins/
│   ├── agentic-tools/        # Shell, filesystem, message, spawn tools
│   ├── agents/               # Multi-agent registry and teams
│   ├── automation/           # Cron, webhook, timer scheduling
│   ├── core/                 # Health, help, plugins, update commands
│   ├── discord/              # Discord connector
│   ├── heartbeat/            # Periodic monitoring
│   ├── memory/               # Persistent memory store
│   ├── orchestrator/         # Multi-agent orchestration
│   ├── services/             # Shared services (connector-agent, transcription, etc.)
│   ├── skills/               # Skill management
│   ├── slack/                # Slack connector
│   ├── system-prompt/        # System prompt assembly
│   ├── telegram/             # Telegram connector
│   ├── wallet/               # Solana wallet
│   ├── web-tools/            # Web fetch and search
│   └── whatsapp/             # WhatsApp connector
├── providers/                # 19 LLM provider definitions
└── plugin-sdk/               # TypeScript types for external plugin authors
```

### Key design patterns

- **Dependency-sorted plugin loading** — topological sort by `manifest.dependencies[]`, then by priority
- **Dual result model** — tools return `forLlm` (seen by model) and `forUser` (shown in TUI) independently
- **Preemptive queues** — connector message queues abort the current LLM call when a new message arrives
- **Three-layer config merge** — defaults > user-global > workspace-local (deep merge, later wins)
- **Hook timeout budgets** — message lifecycle hooks have a 250ms budget to avoid blocking
- **Process locking** — connectors use PID-based lock files to prevent duplicate instances
- **ESM with `.js` extensions** — TypeScript source uses `.js` imports throughout (Node ESM convention)

---

## License

MIT
