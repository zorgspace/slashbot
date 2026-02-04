# GROK.md - Comprehensive Slashbot Documentation

This document provides a complete, actionable guide to understanding, using, developing, and extending **Slashbot**. It is designed for developers, AI assistants (e.g., Slashbot, Claude, GPT), and contributors to immediately onboard and contribute. All explanations include real code examples from the codebase, rationale for patterns, and step-by-step workflows.

Slashbot is a production-ready autonomous CLI AI agent inspired by Claude Code, powered by xAI's Grok API. It enables agentic workflows in the terminal: read/edit files, run shell commands, git ops, web search, scheduling, skills, and multi-platform connectors (Telegram/Discord).

## 1. PROJECT OVERVIEW

**Project Name**: Slashbot  
**Version**: Latest (stable, with recent enhancements like sticky plan display, auto-updates, image support, and process management).  
**Purpose**: A lightweight, autonomous CLI coding assistant that executes real file/system operations via an "agentic loop." Unlike chat-only AIs, Slashbot parses LLM responses for XML action tags (e.g., `<read path="file.ts"/>`), executes them iteratively, and feeds results back until tasks complete. It solves the problem of bridging LLMs with real-world code editing/automation without heavy setups like VS Code extensions.  
**Key Features**:

- **Agentic Execution**: LLM plans → actions (read/edit/bash/git) → results → iterate.
- **Multi-Modal**: Image analysis (paste base64/images), voice transcription (OpenAI optional).
- **Connectors**: Telegram/Discord for remote control.
- **Skills System**: Load modular prompts/capabilities from `~/.slashbot/skills/`.
- **Scheduler**: Cron-based tasks (bash or LLM-powered).
- **Plan UI**: Visual sticky progress tracker for multi-step tasks.
- **Secure**: Permissions system, process isolation, no destructive ops by default.

**Target Users**:

- Developers: Autonomous code editing, debugging, refactoring.
- DevOps: Git automation, scheduled tasks, notifications.
- Remote Teams: Telegram/Discord bots for code reviews/tasks.
- AI Experimenters: Custom skills, agentic loops.

**Problem Solved**: LLMs hallucinate code; manual copy-paste is slow. Slashbot executes safely in your dir, verifies changes (typecheck/format), and iterates autonomously.

**Current Status**: Production-ready (MIT license). Actively maintained (recent commits: auto-update, UI polish, connector improvements). No known breaking issues.

**License**: MIT (per `package.json`).

## 2. TECH STACK & LANGUAGES

**Primary Language**: TypeScript 5.9.3 (strict mode, ESNext target).  
**Runtime**: Bun (preferred; fast bundler/runtime). Node.js compatible via `bun run`. No Deno/Python.  
**Package Manager**: Bun (`bun install`, `bun.lockb`).  
**Bundler**: Bun (`bun build --compile --minify`). Compiles to single `dist/slashbot` binary.  
**Framework**: None (vanilla TS CLI). Modular with **InversifyJS** (DI container).  
**Testing**: Vitest (v4.0.18, V8 coverage, Node env, `src/**/*.test.ts`).  
**Linting/Formatting**: ESLint (TS-focused, unused-imports), Prettier (singleQuote, tabWidth:2).  
**Major Libraries & Purposes**:
| Library | Purpose | Example Usage |
|---------|---------|---------------|
| `discord.js@14.25.1` | Discord bot connector for remote commands. | `src/connectors/discord.ts`: Handles messages, sends responses. |
| `telegraf@4.16.3` | Telegram bot connector. | `src/connectors/telegram.ts`: Polls updates, auto-detects chat ID. |
| `inversify@7.11.0` + `reflect-metadata` | Dependency Injection for services (e.g., `ActionHandlerService`, `TaskScheduler`). | `src/di/container.ts`: `container.get(TYPES.TaskScheduler)`. |
| `zod@4.3.6` | Schema validation (actions/commands). | Implicit in parsers (e.g., `src/actions/parser.ts`). |
| `clipboardy@4.0.0`, `terminal-image@4.2.0` | Image handling (clipboard → base64). | `src/code/imageBuffer.ts`: Adds to vision context. |
| `xml2js@0.6.2` | Parse XML action tags from LLM. | `src/utils/xml.ts`: `<read path="file.ts"/>` → Action object. |
| `dotenv@17.2.3` | Env vars (API keys). | Loads `GROK_API_KEY`. |

**TypeScript Config** (`tsconfig.json`): Strict, ESNext, JSX (unused), declarations enabled. Root `@src`, outDir `@dist`.

## 3. ARCHITECTURE & DESIGN PATTERNS

**High-Level Architecture**: **Modular Monolith** (single binary). Core: **REPL Loop** → Command Parser → GrokClient (agentic loop) → Actions → Services.

- **Layers**:
  1. **CLI/UI** (`src/ui/*`, `src/app/*`): Input (multiline, paste), output (spinner, markdown, sticky plan).
  2. **Commands** (`src/commands/*`): `/login`, `/init` → Handlers.
  3. **API** (`src/api/*`): GrokClient streams responses, parses/executes actions.
  4. **Actions** (`src/actions/*`): XML → Handlers (file/git/shell). **Observer Pattern** via DI.
  5. **Services** (`src/services/*`): Composites (ActionHandlerService wires handlers).
  6. **Connectors** (`src/connectors/*`): Telegram/Discord → Message → handleInput.
  7. **DI** (`src/di/*`): Inversify binds interfaces (e.g., `TYPES.ActionHandlerService`).
  8. **Persistence**: `~/.slashbot/` (config, history, context, skills, tasks).

**Design Patterns**:

- **Dependency Injection (Inversify)**: Services injected via tokens. _Why_: Testable, loose coupling. Ex: `initializeContainer()` → `getService(TYPES.FileSystem)`.
  ```typescript
  // src/di/container.ts (excerpt)
  container.bind<TaskScheduler>(TYPES.TaskScheduler).to(Scheduler).inSingletonScope();
  ```
- **Agentic Loop** (in `GrokClient.chat()`): LLM → Parse XML actions → Execute → Compress results → Feed back → Repeat. _Why_: Autonomous until complete (no fixed iterations). Handles errors/duplicates.
  ```typescript
  // src/api/client.ts (agentic loop excerpt)
  while (true) {
    responseContent = await this.streamResponse();
    actions = parseActions(responseContent);
    actionResults = await executeActions(actions, this.actionHandlers);
    if (actionResults.length === 0) break; // Done
    // Compress + continue
  }
  ```
- **Factory/Registry**: `ConnectorRegistry`, `CommandRegistry`, `SkillManager`. _Why_: Dynamic plugins.
- **Observer/EventBus** (`src/events/EventBus.ts`): Pub/sub for redraws/tasks. _Why_: Decouples UI/scheduler.
- **State Management**: Simple in-memory (history, imageBuffer). Signals (`src/app/signals.ts`) for graceful shutdown.
- **Data Flow**: User input → `parseInput()` → Command or Grok → Actions → Results → Stream/UI.
- **Error Handling**: Try/catch everywhere, abortable fetches, permissions checks. Logs via `errorBlock()`. Fallbacks (e.g., duplicate reads filtered).

**Why These Patterns?** CLI needs speed/simplicity (no Redux/Zustand overkill). DI enables mocking/tests. Agentic loop mimics human dev workflow: plan → act → verify → iterate.

## 4. DIRECTORY STRUCTURE

**Root**:

```
slashbot/
├── .slashbot/          # User data (gitignore'd): config.json, credentials.json, history, context/, skills/, tasks/, locks/
├── dist/               # Built binary (gitignore'd)
├── src/                # Source code
├── package.json        # Scripts/deps
├── tsconfig.json       # TS config
├── vitest.config.ts    # Tests
├── eslint.config.js    # Linting
└── .prettierrc         # Formatting
```

**src/** (Entry: `index.ts` bootstraps DI → services → REPL):

```
src/
├── index.ts            # Main: Slashbot class, REPL loop, connectors init
├── app/                # CLI bootstrap
│   ├── cli.ts          # Arg parsing (/login --help)
│   └── signals.ts      # SIGINT/SIGTERM handlers
├── api/                # Grok integration
│   ├── grok.ts         # Exports
│   ├── client.ts       # Core: chat(), agentic loop, streaming
│   ├── prompts/        # system.ts: Massive system prompt
│   ├── types.ts        # Message, Config
│   └── utils.ts        # compressActionResults(), getEnvironmentInfo()
├── actions/            # XML-parsed ops (core agentic power)
│   ├── parser.ts       # XML → Action[] (zod/xml2js)
│   ├── executor.ts     # Sequential exec + results
│   ├── handlers/       # Per-type: shell.ts (bash), file.ts (read/edit), git.ts, etc.
│   └── types.ts        # Action union (ReadAction, EditAction, etc.)
├── commands/           # /slash commands
│   ├── parser.ts       # Text → Command
│   ├── registry.ts     # Dynamic handler registry
│   └── handlers/       # init.ts (/init analyzes codebase), login.ts, etc.
├── connectors/         # Telegram/Discord
│   ├── base.ts         # Interface
│   ├── telegram.ts     # Telegraf bot
│   └── discord.ts      # discord.js client
├── di/                 # Inversify
│   ├── container.ts    # Init/bind services
│   └── types.ts        # Symbol tokens (TYPES.TaskScheduler)
├── ui/                 # Terminal UX (chalk-based)
│   ├── core.ts         # colors, c util
│   ├── multilineInput.ts # Shift+Enter REPL
│   ├── pasteHandler.ts # Bracketed paste → placeholders
│   ├── plan/           # Sticky progress display
│   ├── display/        # File viewer, steps
│   ├── components/     # Prompt, banner, box
│   └── animations/     # Thinking spinner
├── services/           # Composites
│   ├── ActionHandlerService.ts # Wires action handlers
│   ├── ConnectorRegistry.ts    # Manages connectors
│   ├── PlanManager.ts          # Plan persistence/UI
│   └── transcription.ts        # OpenAI voice (optional)
├── scheduler/          # Cron tasks
│   ├── scheduler.ts    # TaskScheduler (persistent)
│   └── cron.ts         # Parser
├── skills/             # Modular prompts
│   ├── manager.ts      # Loads/injects into system prompt
│   └── visual-art-skill.md # Example
├── config/             # ~/.slashbot persistence
│   └── config.ts       # ConfigManager (API keys, connectors)
├── code/               # Editor ops
│   ├── editor.ts       # WorkDir, listFiles, authorize
│   └── imageBuffer.ts  # Vision context
├── utils/              # Helpers
│   ├── xml.ts          # Tag parsing
│   └── processManager.ts # Background procs (ps/kill)
├── fs/                 # Secure FS
│   └── filesystem.ts   # Permissions-gated
├── security/           # Permissions
│   └── permissions.ts
├── events/             # EventBus
│   └── EventBus.ts
├── constants.ts        # Paths (HOME_SLASHBOT_DIR)
└── updater.ts          # Auto-update check
```

**Bootstrapping Flow** (`index.ts`):

1. DI init → Services (scheduler, config, editor...).
2. Load config/history/Grok.
3. Start scheduler/connectors.
4. Banner → REPL (`readMultilineInput()`).

**Where to Find**:

- Routes: N/A (CLI).
- Models: `actions/types.ts`.
- Utils: `src/utils/*`.
- Config: `~/.slashbot/config.json`.

## 5. CODE CONVENTIONS & STYLE

**Formatting** (Prettier): 100-char width, semi:true, singleQuote, trailingComma:all, tabWidth:2, no tabs.  
**Naming**: camelCase (vars/functions), PascalCase (classes/interfaces), snake_case (none). Paths kebab-case.  
**Imports**: Auto-sorted by ESLint. Relative for local, named for deps. No side-effects first.  
 Ex: `import { c } from './ui/colors';`  
**Comments**: JSDoc for public methods. Inline for why (e.g., security).  
**Types**: Strict TS (noImplicitAny:false but noFloatingPromises:error). Interfaces everywhere (Action, Message).  
**Error Handling**: `try/catch`, abort controllers, `errorBlock(msg)`. Permissions pre-checks.  
**ESLint Rules** (key): unused-imports error, no-floating-promises, prefer-nullish-coalescing warn. Project-aware parser.  
**Patterns**:

- **Single Responsibility**: Handlers per action/command.
- **Async Everywhere**: Promises for FS/shell/API.
- **Constants**: `src/config/constants.ts` (GROK_CONFIG.MAX_RESULT_CHARS=8000).
- **Logs**: `c.success()`, `c.muted()` (chalk wrappers).
- **Testing After Modifications**: Always try to test when you modify a code to ensure quality and catch issues early.

Ex: Clean handler (`src/actions/handlers/file.ts` excerpt):

```typescript
export async function executeRead(
  path: string,
  options?: { offset?: number; limit?: number },
): Promise<string> {
  try {
    // Permissions + read
    const content = await secureFS.readFile(path, options);
    return `File read successfully: ${path}\n\n${content}`;
  } catch (error) {
    return `Failed to read ${path}: ${(error as Error).message}`;
  }
}
```

## 6. HOW TO USE (for developers)

**Installation**:

```bash
git clone <repo> slashbot
cd slashbot
bun install
bun run build  # Creates dist/slashbot
bun run install-global  # sudo cp to /usr/local/bin (Linux/macOS)
```

**Environment Setup** (`.env` or `~/.slashbot/credentials.json`):
| Var | Description | Required? |
|-----|-------------|-----------|
| `GROK_API_KEY` / `XAI_API_KEY` | xAI Grok API key. | Yes |
| `OPENAI_API_KEY` | Optional: Voice transcription. | No |
| Telegram: `/telegram-config <botToken> [chatId]` | Bot from @BotFather. | No |
| Discord: `/discord-config <botToken> <channelId>` | Dev Portal token + channel ID. | No |

**Running**:

- Dev: `bun run dev` (src/index.ts).
- Prod: `./dist/slashbot` or `slashbot`.
- Global: `slashbot`.

**Tests**: `bun run test` (Vitest), `bun run test:watch`, `bun run test:coverage`.  
**Build/Prod**: `bun run build` → single binary. Deploy via curl install script (from commits).  
**Deployment**: Binary-only (no Docker). Global install script: `curl -sL https://github.com/.../install.sh | bash`.

Ex: First run → Banner shows version, dir, tasks, connectors.

## 7. HOW TO DEVELOP & EXTEND

**Adding Features**:

- New Service: Interface → DI bind → Inject (e.g., `TYPES.NewService`).
- New Action: `actions/types.ts` (union), `actions/handlers/new.ts` (handler), register in `ActionHandlerService`.

**Adding API Endpoints**: N/A (CLI). For custom: Extend `GrokClient.chat()`.

**Adding New Slash Command** (step-by-step):

1. `src/commands/handlers/new.ts`: Handler func.
   ```typescript
   // Ex: src/commands/handlers/images.ts
   export async function handleImages(ctx: CommandContext) {
     console.log(`Images: ${imageBuffer.length}`);
     return true;
   }
   ```
2. `src/commands/handlers/index.ts`: Export.
3. `src/commands/registry.ts`: `registry.register('images', handleImages)`.
4. Test: `vitest src/commands/handlers/new.test.ts`.

**Adding Components/Modules**:

- UI: `src/ui/components/new.ts` (chalk/box/spinner).
- Skill: `~/.slashbot/skills/new.md` (prompt) or `<skill-install url="..."/>`.
- Connector: Extend `base.ts` → `connectors/new.ts` → Registry.

**Database Changes**: No DB (file-based). Edit `ConfigManager` for JSON.

**Testing**:

- Unit: `vitest src/actions/executor.test.ts` (mocks DI).
- Coverage: `--coverage` (V8, HTML/LCOV).
- Mock DI: `vi.mock('./di/container')`.

**Migrations**: None. Versioned tasks in `.slashbot/tasks/`.

## 8. COMMON TASKS & PATTERNS

**Authentication**: `/login` → Prompts API key → Saves to `~/.slashbot/credentials.json`.

```bash
slashbot
/login  # Interactive
```

**Database Interaction**: No DB. FS via `CodeEditor`/`SecureFileSystem`.
Ex: LLM auto: `<read path="src/index.ts"/>`.

**UI Components** (add/modify):

```typescript
// src/ui/components/banner.ts (ex)
export function banner(info: BannerInfo): string {
  return c.banner(`Slashbot v${info.version} | ${info.workingDir}`);
}
```

Use: `console.log(banner({version: '1.2.0', ...}))`.

**CLI Commands** (in REPL):

- `/help`: All commands.
- `/init`: Codebase analysis → CLAUDE.md.
- `/ps`: Processes.
- `/kill <id>`: Stop proc.

**Patterns**:

- **Agentic Fix**: "Fix bug in login" → LLM reads → edits → typecheck → iterates.
- **Multi-Line**: Shift+Enter.
- **Paste**: Cmd+V → `[pasted:1:3 lines]`, expands on send.
- **Images**: Paste base64/path → Vision model auto-switches.

Ex: Shell action result compression (`src/api/utils.ts`):

```typescript
compressActionResults([{ action: 'bash ls', result: 'file1\nfile2', success: true }]);
// "[✓] bash ls\nfile1\nfile2"
```

## 9. DEPENDENCIES & EXTERNAL SERVICES

**Runtime Deps**: Minimal (clipboardy, discord.js, etc.). Bun required.  
**Database**: None (JSON in `~/.slashbot/`).  
**API Keys**:

- **Required**: Grok (x.ai/api).
- **Optional**: OpenAI (transcription).
  **External Services**:
- xAI Grok API (chat/completions, responses for search).
- Telegram/Discord (bots).
- No Docker.

**Install Missing Tools**: LLM auto: `<bash>apt install ripgrep</bash>` (safe VM assumed).

## 10. GOTCHAS & IMPORTANT NOTES

**Non-Obvious**:

- **Image Model Switch**: Auto-uses vision model if images in buffer/history.
- **Paste Expansion**: CLI-only; expands `[pasted:1:...]` on send.
- **Duplicate Reads**: Filtered in agent loop (max 3 warnings).
- **History**: `~/.slashbot/history` (last 500).

**Performance**:

- Context: 256k tokens, compresses results (MAX_RESULT_CHARS=8000).
- Streaming: Real-time output, thinking spinner.
- Procs: Detached (setsid/nohup), max 100 output lines.

**Security**:

- Permissions (`src/security/permissions.ts`): Blocks rm/git push --force.
- Scheduled LLM: Restricted prompt wrapper.
- FS: WorkDir-bound, authorize via `/authorize`.
- No eval/exec injection (parsed XML).

**Breaking Changes**: Latest: Enhanced UX/stability. Check commits.
**Known Issues**:

- Linux images: xclip/wl-paste required.
- Telegram: Restart after config.
- No Windows native (Bun focus).

## 11. COMMAND REFERENCE

**npm/Bun Scripts** (`package.json`):
| Script | Description |
|--------|-------------|
| `dev` | Run src/index.ts (dev REPL). |
| `build` | Compile to dist/slashbot (minified binary). |
| `install-global` | Build + sudo install to /usr/local/bin. |
| `start` | Run binary. |
| `typecheck` | tsc --noEmit. |
| `test` | Vitest run. |
| `test:watch` | Vitest watch. |
| `test:ui` | Vitest UI. |
| `test:coverage` | Coverage report. |

**Slash Commands** (in REPL):

- `/help`, `/?`: List all.
- `/login`: API key.
- `/logout`: Clear key.
- `/init`: Analyze codebase.
- `/model [name]`: Switch model.
- `/personality [normal|depressed|sarcasm|unhinged]`.
- `/clear`: History.
- `/ps`, `/kill <id|pid>`.
- `/skills`: List/install.
- `/tasks`: Scheduler.
- `/telegram-config`, `/discord-config`.

**CLI Args** (`slashbot --help`):

- `--version`: Print v1.2.0.
- `--login`: Interactive key.

**Common Dev**:

```bash
bun run dev  # REPL
slashbot /init  # Analyze
Ctrl+C  # Graceful stop (kills procs)
```
