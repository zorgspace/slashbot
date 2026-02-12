# Slashbot Architecture

Technical deep-dive into Slashbot's internal architecture. This document covers how the major systems work and how they connect.

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────┐
│                     Entry Point                      │
│                    src/index.ts                       │
│              (REPL loop + bootstrapping)              │
└────────────┬───────────────────────────┬─────────────┘
             │                           │
     ┌───────▼───────┐         ┌────────▼────────┐
     │   DI Container │         │  Plugin Registry │
     │  (InversifyJS)  │◄───────│  (loader + init)  │
     └───────┬────────┘         └────────┬─────────┘
             │                           │
   ┌─────────▼─────────────────┐   ┌────▼──────────────┐
   │      Core Services         │   │  Plugin System     │
   │  ConfigManager             │   │  14 built-in       │
   │  FileSystem                │   │  + third-party     │
   │  CodeEditor                │   │                    │
   │  TaskScheduler             │   │  Contributions:    │
   │  EventBus                  │   │  - Actions         │
   │  CommandRegistry           │   │  - Prompts         │
   │  ConnectorRegistry         │   │  - Commands        │
   └─────────┬─────────────────┘   │  - Context         │
             │                      │  - Events          │
   ┌─────────▼─────────────────┐   │  - Sidebar         │
   │      Grok API Client       │   └────────────────────┘
   │  Streaming + tool use      │
   │  PromptAssembler           │
   │  ProxyAuthProvider         │
   └─────────┬─────────────────┘
             │
   ┌─────────▼──────────────────────────────────────┐
   │                  Connectors                      │
   │     CLI        Telegram        Discord           │
   └──────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── index.ts                 # Entry point, REPL loop, bootstrapping
├── core/
│   ├── api/                 # Grok API client
│   │   ├── client.ts        # GrokClient - streaming, tool use, auth
│   │   ├── prompts/
│   │   │   ├── core.ts      # Universal behavioral rules
│   │   │   └── assembler.ts # PromptAssembler
│   │   ├── types.ts         # ApiAuthProvider, etc.
│   │   ├── sessions.ts      # Session management
│   │   └── utils.ts
│   ├── actions/
│   │   ├── parser.ts        # Dynamic action parser registry
│   │   ├── executor.ts      # Dynamic action executor
│   │   └── types.ts         # Action, ActionResult, ActionHandlers
│   ├── commands/
│   │   └── registry.ts      # CommandRegistry
│   ├── config/
│   │   ├── constants.ts     # All hardcoded values (centralized)
│   │   ├── config.ts        # ConfigManager
│   │   └── permissions.ts   # Command permission system
│   ├── di/
│   │   ├── container.ts     # InversifyJS container setup
│   │   └── types.ts         # Service tokens (TYPES)
│   ├── events/
│   │   └── EventBus.ts      # Typed event bus
│   ├── ui/                  # OpenTUI terminal interface
│   │   ├── TUIApp.ts        # Main orchestrator
│   │   ├── panels/          # HeaderPanel, ChatPanel, CommPanel, InputPanel
│   │   └── adapters/        # OutputInterceptor
│   ├── code/
│   │   └── editor.ts        # CodeEditor (unified diff application)
│   ├── scheduler/
│   │   └── scheduler.ts     # Cron-based task scheduler
│   ├── services/
│   │   ├── filesystem.ts    # FileSystem service
│   │   └── transcription.ts # Audio transcription
│   ├── utils/
│   │   ├── tagRegistry.ts   # Dynamic action tag registry
│   │   └── input.ts         # promptPassword utility
│   └── app/
│       ├── cli.ts           # CLI argument parsing
│       ├── signals.ts       # Signal handling (SIGINT, etc.)
│       └── updater.ts       # Auto-update check
├── plugins/
│   ├── types.ts             # Plugin interface definitions
│   ├── registry.ts          # PluginRegistry
│   ├── loader.ts            # Plugin loader (static imports)
│   ├── installer.ts         # GitHub plugin installer
│   ├── bash/                # Core: shell execution
│   ├── filesystem/          # Core: file operations
│   ├── code-editor/         # Core: format, typecheck, auto-fix
│   ├── web/                 # Core: web fetch + search
│   ├── say/                 # Core: console output
│   ├── system/              # Core: system info
│   ├── session/             # Core: session management
│   ├── explore/             # Feature: codebase exploration
│   ├── tasks/               # Feature: task management
│   ├── skills/              # Feature: skill loading
│   ├── scheduling/          # Feature: cron jobs
│   ├── heartbeat/           # Feature: periodic reflection
│   └── wallet/              # Feature: Solana wallet + payments
└── connectors/
    ├── base.ts              # Connector interface
    ├── registry.ts          # ConnectorRegistry
    ├── telegram/            # Telegram bot connector
    └── discord/             # Discord bot connector
```

---

## Plugin System

The plugin system is the backbone of Slashbot. Every capability — file operations, shell execution, wallet management, even console output — is implemented as a plugin.

### Plugin Interface

```typescript
interface Plugin {
  readonly metadata: PluginMetadata; // id, name, version, category, dependencies
  init(context: PluginContext): Promise<void>; // Called during bootstrap

  // Contributions
  getActionContributions(): ActionContribution[]; // XML action tags
  getPromptContributions(): PromptContribution[]; // System prompt sections
  getCommandContributions?(): CommandHandler[]; // Slash commands
  getContextProviders?(): ContextProvider[]; // Dynamic context
  getEventSubscriptions?(): EventSubscription[]; // Event listeners
  getSidebarContributions?(): SidebarContribution[]; // TUI sidebar items
  getKernelHooks?(): KernelHookContribution[]; // Kernel extension hooks

  // Lifecycle hooks
  onBeforeGrokInit?(context: PluginContext): Promise<void>;
  onAfterGrokInit?(context: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
}
```

### Plugin Categories

| Category      | Purpose                | Examples                  |
| ------------- | ---------------------- | ------------------------- |
| **Core**      | Essential capabilities | bash, filesystem, say     |
| **Feature**   | Optional functionality | wallet, heartbeat, skills |
| **Connector** | Platform integrations  | telegram, discord         |

### Plugin Lifecycle

1. **Load** — `loadBuiltinPlugins()` instantiates all built-in plugins
2. **Register** — `PluginRegistry.registerAll()` stores them, validates uniqueness
3. **Sort** — Topological sort resolves dependency order
4. **Init** — `initAll()` calls `plugin.init(context)` in dependency order
5. **Contribute** — Registry collects contributions (actions, prompts, commands, etc.)
6. **Lifecycle hooks** — `onBeforeGrokInit()` and `onAfterGrokInit()` fire during API client setup
7. **Kernel hooks** — `getKernelHooks()` can patch payloads for startup/runtime events (`startup:*`, `input:*`, `render:*`, `tabs:*`, `sidebar:*`)
8. **Destroy** — `destroyAll()` tears down in reverse order

### Kernel Hook Contributions

Kernel hooks let plugins extend runtime behavior without editing `kernel.ts`.

```typescript
type KernelHookEvent =
  | 'startup:after-grok-ready'
  | 'startup:after-connectors-ready'
  | 'startup:after-ui-ready'
  | 'input:before'
  | 'input:after-command'
  | 'input:after'
  | 'run:noninteractive:before'
  | 'render:before'
  | 'render:after'
  | 'tabs:before'
  | 'tabs:after'
  | 'sidebar:before'
  | 'sidebar:after'
  | 'shutdown:before';

interface KernelHookContribution {
  event: KernelHookEvent;
  order?: number; // lower runs first, default 100
  handler:
    | ((payload, context) => void | Partial<typeof payload>)
    | ((payload, context) => Promise<void | Partial<typeof payload>>);
}
```

Hooks are applied in deterministic order and can return a shallow patch object to update downstream payloads.
Examples: connector plugins inject sidebar status + protected tabs through hooks, and planning owns its trigger flow through `input:before`.

### Plugin Context

Plugins receive a `PluginContext` at init time:

```typescript
interface PluginContext {
  container: Container; // DI container for service access
  eventBus?: EventBus; // Event system
  configManager?: ConfigManager; // App configuration
  workDir?: string; // Current working directory
  getGrokClient?: () => GrokClient; // API client accessor
}
```

### Action Contributions

Each plugin defines the XML action tags it handles. The LLM generates these tags in its responses, and Slashbot parses and executes them.

```typescript
interface ActionContribution {
  type: string; // e.g., "bash", "read", "edit"
  tagName: string; // XML tag name
  handler: Record<string, Function>; // Business logic functions
  execute: (action, handlers) => ActionResult; // Display/formatting
}
```

The `handler` contains the actual logic (run a command, read a file), while `execute` handles output formatting and user display.

### Plugin-Autonomous Parsing

Each plugin has a `parser.ts` that defines how its XML tags are parsed:

```typescript
interface ActionParserConfig {
  tags: string[]; // Tags this parser handles
  selfClosingTags?: string[]; // Self-closing tag variants
  parse: (content, utils) => Action[]; // Parse raw XML to Action objects
  protectedTags?: string[]; // Tags that shouldn't be stripped
  fixups?: Array<{ from: RegExp; to: string }>; // Pre-parse corrections
}
```

Parsers auto-register their tags in the global `tagRegistry` so the streaming parser knows which tags to look for.

---

## Dependency Injection

Slashbot uses InversifyJS with a singleton container. Services are registered at startup and accessed via `container.get(TYPES.ServiceName)`.

### Service Tokens

```typescript
const TYPES = {
  GrokClient,
  TaskScheduler,
  FileSystem,
  ConfigManager,
  CodeEditor,
  SkillManager,
  CommandPermissions,
  HeartbeatService,
  ConnectorRegistry,
  CommandRegistry,
  EventBus,
  PluginRegistry,
};
```

### Container Initialization

```
initializeContainer()
  → bind ConfigManager, FileSystem, TaskScheduler, CodeEditor, CommandPermissions
  → bind EventBus, ConnectorRegistry, CommandRegistry
  → plugins self-register additional services (SkillManager, HeartbeatService, etc.)
```

Plugins access services with `context.container.get(TYPES.ServiceName)`, using try/catch for optional services that may not be present.

---

## Event Bus

The EventBus is a typed pub/sub system built on Node.js `EventEmitter`.

### Core Events (Typed)

| Event                    | Payload                                |
| ------------------------ | -------------------------------------- |
| `task:complete`          | taskId, taskName, output               |
| `task:error`             | taskId, taskName, error                |
| `task:started`           | taskId, taskName                       |
| `connector:message`      | source (cli/telegram/discord), message |
| `connector:response`     | source, response                       |
| `connector:connected`    | source                                 |
| `connector:disconnected` | source                                 |
| `grok:initialized`       | —                                      |
| `grok:disconnected`      | —                                      |
| `prompt:redraw`          | —                                      |

### Plugin Events (Generic)

Plugins can emit and subscribe to any string-typed event. The overload signature accepts `{ type: string; [key: string]: any }` for complete extensibility.

### Wildcard Listener

`eventBus.onAny(handler)` subscribes to all events, useful for logging or the comm panel.

---

## Prompt Assembly

The system prompt is built dynamically at runtime by the `PromptAssembler`.

### Flow

```
CORE_PROMPT (universal behavioral rules)
  + Plugin PromptContributions (sorted by priority)
    + Dynamic ContextProviders (runtime state)
  = Complete system prompt
```

### PromptContribution

```typescript
interface PromptContribution {
  id: string; // Unique identifier
  title: string; // Section heading in prompt
  priority: number; // Sort order (lower = earlier in prompt)
  content?: string | Function | readonly string[];
  enabled?: boolean | Function; // Conditional inclusion
}
```

Each plugin contributes sections describing its capabilities to the LLM. For example, the wallet plugin adds documentation about `<wallet-status/>` and `<wallet-send/>` tags.

### Context Providers

Plugins can also provide dynamic context that changes at runtime:

```typescript
interface ContextProvider {
  priority?: number;
  isActive?: () => boolean; // Only included when active
  getContext: () => Promise<string | null>;
}
```

---

## Action System

The action system is how the LLM interacts with the outside world. The LLM generates XML action tags in its responses, which are parsed and executed.

### Flow

```
LLM Response (streaming)
  → Tag detection (tagRegistry)
  → parseActions() iterates all registered parsers
  → executeActions() dispatches via dynamicExecutorMap
  → ActionResult fed back to LLM as tool results
```

### Execution Order

1. **Transparent actions** (`say`, `continue`) execute first — they don't produce tool results
2. **Real actions** execute sequentially in the order the LLM listed them

### Dynamic Executor Map

At startup, plugin action contributions are compiled into a `Map<string, executor>`. The `setDynamicExecutorMap()` function wires this into the executor. This means no action type is hardcoded in the core — everything comes from plugins.

---

## Connectors

Connectors bridge Slashbot to different platforms. Each connector implements the `Connector` interface.

### Connector Interface

```typescript
interface Connector {
  readonly source: ConnectorSource; // 'cli' | 'telegram' | 'discord' | ...
  readonly config: ConnectorConfig; // maxMessageLength, supportsMarkdown, etc.
  setMessageHandler(handler: MessageHandler): void;
  start(): Promise<void>;
  stop(): void;
  sendMessage(text: string): Promise<void>;
  isRunning(): boolean;
}
```

### ConnectorSource

The type is intentionally extensible: `'cli' | 'telegram' | 'discord' | (string & {})`. Third-party plugins can add any connector source.

### Message Flow

```
User input (platform-specific)
  → Connector.messageHandler(message, source)
  → GrokClient processes message
  → Actions execute
  → Response sent back via Connector.sendMessage()
```

Messages are automatically split at platform-specific limits (4096 for Telegram, 2000 for Discord) with smart splitting at newlines/spaces.

---

## Terminal UI (OpenTUI)

The full-screen TUI is built with `@opentui/core` and consists of:

| Panel                   | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| **HeaderPanel**         | App name, status indicators, model info               |
| **ChatPanel**           | Main conversation display                             |
| **CommPanel**           | Communication log (Ctrl+T toggle) — prompts/responses |
| **InputPanel**          | User input with history                               |
| **CommandPalettePanel** | Fuzzy command search                                  |

### Output Interceptor

The `OutputInterceptor` monkey-patches `process.stdout.write` and `console.log` to redirect output into the ChatPanel. This means plugins can use `console.log` normally and it appears in the TUI.

### Sidebar

The sidebar is built dynamically from plugin `SidebarContribution` objects, then post-processed by kernel hooks (`sidebar:before` / `sidebar:after`). This keeps connector-specific indicators plugin-owned instead of hardcoded in `kernel.ts`.

---

## Code Editing

Slashbot uses a unified diff format for code edits, allowing the LLM to specify precise line-based changes.

### Format

```
<edit path="src/example.ts">
@@ -10,3 @@
-  const old = true;
+  const updated = false;
   // context line
</edit>
```

### Application

1. Parse `@@ -startLine,count @@` hunk headers
2. Sort hunks bottom-to-top (so line numbers stay valid)
3. Splice lines array: remove `-` lines, insert `+` lines, verify ` ` context lines
4. Soft verification: warns on mismatch but still applies

### Read Format

`<read>` actions return numbered lines (`   1: content`) so the LLM always has line numbers available for subsequent edits.

---

## Security

### Command Safety

- Dangerous shell patterns are blocked at parse time (see `DANGEROUS_PATTERNS` in constants.ts)
- Git operations have an allowlist of safe commands
- File edits have a max deletion ratio (80%) to prevent accidental wipes

### Wallet Security

- Private keys encrypted with AES-256-GCM
- Password-derived keys via PBKDF2-like salt stretching
- Session-based auth with 30-minute timeout
- Session auth uses request-body signing (the keypair signs each request)
- Passwords never stored or logged

### Permission System

- Per-command permissions stored in `permissions.json`
- Configurable per-project (local `.slashbot/permissions.json`)

---

## Configuration

All configuration is centralized in `src/core/config/constants.ts` with sensible defaults. User configuration lives in `~/.slashbot/`:

| File                 | Purpose                          |
| -------------------- | -------------------------------- |
| `config/config.json` | Model, payment mode, temperature |
| `credentials.json`   | API keys                         |
| `wallet.json`        | Encrypted Solana wallet          |
| `wallet-config.json` | Proxy URL, wallet address        |
| `permissions.json`   | Command permissions              |
| `heartbeat.json`     | Heartbeat settings               |
| `skills/`            | Installed skill files            |
| `tasks/`             | Scheduled task definitions       |
| `context/`           | Conversation dumps               |
| `history`            | Command history                  |

---

_See also: [TOKEN_UTILITY.md](./TOKEN_UTILITY.md) | [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md) | [ROADMAP.md](./ROADMAP.md)_
