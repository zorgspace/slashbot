# GROK.md - Slashbot Project Documentation

This document provides a comprehensive guide to the **Slashbot** project, a CLI assistant powered by the Grok API. It is designed for developers and AI assistants to understand, use, and contribute to the codebase effectively. The content is structured to be detailed, actionable, and clear, with examples and explanations of key concepts and patterns.

---

## 1. PROJECT OVERVIEW

### Project Name
Slashbot

### Purpose
Slashbot is a lightweight command-line interface (CLI) assistant powered by the Grok API from X.AI. It serves as an alternative to tools like Claude Code, offering AI-driven assistance directly in the terminal. Slashbot enables developers to interact with an AI agent for tasks such as code editing, file management, task scheduling, web searches, and integrations with platforms like Telegram and Discord.

### Problem Solved
Slashbot addresses the need for a terminal-based AI assistant that can:
- Automate repetitive development tasks (e.g., file edits, code formatting, git operations).
- Provide contextual assistance by understanding project files and environment.
- Execute complex workflows through natural language commands.
- Integrate with external communication platforms for notifications and remote interaction.
- Support autonomous operation with scheduled tasks and background processes.

### Target Audience
- **Developers**: Individuals working on software projects who need a terminal-based AI tool to assist with coding, debugging, and automation.
- **DevOps Engineers**: Professionals managing infrastructure who can use Slashbot for scripting and task scheduling.
- **AI Enthusiasts**: Users experimenting with AI-driven CLI tools for productivity.
- **Remote Teams**: Groups using Telegram or Discord integrations for collaborative workflows.

### Current Status
- **Version**: 1.1.0 (based on `package.json` and recent commits indicating active development).
- **Status**: Production-ready with active enhancements. Recent commits show features like auto-updates, improved UX, and connector stability, suggesting a stable core with ongoing improvements.

### License
- **MIT License**: As specified in `package.json`, allowing for open use, modification, and distribution.

---

## 2. TECH STACK & LANGUAGES

### Primary Language
- **TypeScript**: The codebase is entirely written in TypeScript, ensuring type safety and modern JavaScript features. Version compatibility is tied to the TypeScript compiler settings in `tsconfig.json` (targeting ESNext).

### Runtime
- **Bun**: Slashbot uses Bun as the runtime environment, a fast JavaScript runtime built on JavaScriptCore. It replaces Node.js for better performance and is required to run the application. The project explicitly checks for Bun in `src/index.ts` and fails if not present.

### Framework(s)
- **None**: Slashbot does not rely on a specific framework like React or Express. It is a standalone CLI application built with modular TypeScript code.

### Major Libraries and Their Purposes
- **clipboardy (^4.0.0)**: Handles clipboard operations, particularly for image pasting in the terminal.
- **discord.js (^14.25.1)**: Provides integration with Discord for messaging and bot functionality.
- **dotenv (^17.2.3)**: Loads environment variables from `.env` files for configuration (though not explicitly used in code, it's a dependency).
- **telegraf (^4.16.3)**: Facilitates Telegram bot integration for messaging and notifications.
- **terminal-image (^4.2.0)**: Likely used for rendering images in the terminal (though not directly referenced in provided snippets).

### Development Dependencies
- **@types/bun (^1.3.6)**: Type definitions for Bun runtime.
- **@types/node (^25.1.0)**: Type definitions for Node.js compatibility.
- **typescript (^5.9.3)**: TypeScript compiler for type checking and transpilation.
- **vitest (^4.0.18)**: Testing framework for unit tests, with coverage support via `@vitest/coverage-v8`.
- **zod (^4.3.6)**: Schema validation library, potentially for configuration or input validation.
- **zustand (^5.0.11)**: State management library, though not explicitly used in core files.

### Package Manager
- **Bun**: Used as the package manager for dependency installation and script execution, as seen in `package.json` scripts like `bun install` and `bun run`.

---

## 3. ARCHITECTURE & DESIGN PATTERNS

### High-Level Architecture
- **Monolithic Modular Design**: Slashbot is a single CLI application with a modular structure. Core functionality is split into distinct modules (e.g., `api`, `actions`, `connectors`, `ui`) that are orchestrated through a central `Slashbot` class in `src/index.ts`. This design allows for easy extension while maintaining a single entry point.
- **Agentic Loop**: The application implements an agentic loop in the `GrokClient` class (`src/api/grok.ts`), where the AI processes user input, executes actions, and iterates based on results until the task is complete. This enables autonomous behavior for complex tasks.

### Design Patterns Used
- **Factory Pattern**: Used for creating instances of major components like `GrokClient`, `ConfigManager`, and connectors (`createGrokClient`, `createConfigManager`, etc.). This abstracts instantiation logic and improves testability.
- **Command Pattern**: Implemented in `src/commands/parser.ts` to parse and execute user commands (e.g., `/login`, `/help`) as distinct actions.
- **Observer Pattern**: Seen in event-driven components like connectors (`TelegramConnector`, `DiscordConnector`) where message handlers react to incoming messages.
- **Singleton-like Behavior**: While not strictly enforced, the `Slashbot` class in `src/index.ts` acts as a central coordinator with a single instance (`currentBot`) managing the application lifecycle.
- **Strategy Pattern**: Used for action execution in `src/actions/executor.ts`, where different action types (e.g., `bash`, `edit`, `read`) are handled by specific strategies defined in the `ActionHandlers` interface.

### State Management Approach
- **In-Memory State**: State is managed in-memory within the `Slashbot` class, including conversation history (`GrokClient`), configuration (`ConfigManager`), and task scheduling (`TaskScheduler`). There is no persistent state beyond file-based storage for configuration and history.
- **Context Compression**: The `GrokClient` implements context compression to manage conversation history size, ensuring efficient token usage with the AI model by limiting the number of retained messages.

### Data Flow Patterns
- **Request-Response with Iteration**: User input flows through the `Slashbot` class to the `GrokClient`, which interacts with the Grok API. Responses are parsed for actions, executed, and results are fed back into the conversation for further processing if needed (agentic loop).
- **Event-Driven**: Connectors like Telegram and Discord listen for messages and trigger the input handling pipeline asynchronously, ensuring non-blocking operation.
- **File-Based Persistence**: Configuration and history are persisted to files in the user's home directory (`.slashbot/`), ensuring settings are retained across sessions.

### Error Handling Patterns
- **Graceful Degradation**: Errors during API calls, action execution, or connector initialization are caught and logged with user-friendly messages, allowing the application to continue running (e.g., `process.on('uncaughtException')` in `src/index.ts`).
- **Retry Logic**: The agentic loop in `GrokClient` retries tasks when actions fail, feeding error messages back to the AI for resolution.
- **User Feedback**: Errors are displayed in the terminal with color-coded messages (via `errorBlock` in `src/ui/colors.ts`), ensuring visibility without crashing the application.
- **Abort Handling**: Supports aborting long-running operations (e.g., API calls) via `AbortController` in `GrokClient`, with user interruption (Ctrl+C) handled gracefully.

---

## 4. DIRECTORY STRUCTURE

### Overview
The Slashbot project follows a modular directory structure with clear separation of concerns. Below is an explanation of every major directory and key files, along with their purposes.

### Major Directories and Purposes
- **`.slashbot/`**: Local configuration and data directory in the user's home directory (not in the repo). Stores API keys, history, and context files for persistence across sessions.
  - **`.slashbot/config`**: Configuration files (e.g., API keys, connector settings).
  - **`.slashbot/context`**: Stores project-specific context files (e.g., notes, plans) organized by topic.
  - **`.slashbot/skills`**: Custom skills installed by the user for extending AI capabilities.
  - **`.slashbot/tasks`**: Persisted scheduled tasks for the scheduler.
  - **`.slashbot/locks`**: Lock files to prevent multiple instances of connectors (e.g., Discord, Telegram) from running simultaneously.
- **`src/`**: Source code directory containing all application logic.
  - **`src/api/`**: API client implementations for interacting with external services.
    - **`grok.ts`**: Core client for Grok API, handling chat, streaming, and action execution.
  - **`src/actions/`**: Logic for parsing and executing AI-generated actions (e.g., file edits, bash commands).
    - **`parser.ts`**: Parses XML action tags from AI responses.
    - **`executor.ts`**: Executes parsed actions using defined handlers.
    - **`types.ts`**: Type definitions for actions and handlers.
  - **`src/code/`**: Utilities for code editing and image handling.
    - **`editor.ts`**: Handles file operations like reading, editing, and creating files.
    - **`imageBuffer.ts`**: Manages image data for vision model input.
  - **`src/commands/`**: Command parsing and execution for slash commands (e.g., `/login`, `/help`).
    - **`parser.ts`**: Parses user input for commands and delegates execution.
  - **`src/config/`**: Configuration management for API keys and settings.
    - **`config.ts`**: Manages loading and saving configuration data.
  - **`src/connectors/`**: Integration with external platforms like Telegram and Discord.
    - **`telegram.ts`**: Telegram bot connector for messaging and notifications.
    - **`discord.ts`**: Discord bot connector for similar functionality.
    - **`base.ts`**: Base classes and utilities for connectors.
    - **`locks.ts`**: Manages lock files to prevent multiple connector instances.
  - **`src/fs/`**: Filesystem utilities for secure file operations.
    - **`filesystem.ts`**: Provides a secure interface for file read/write operations.
  - **`src/scheduler/`**: Task scheduling for automated operations.
    - **`scheduler.ts`**: Core scheduler for managing and running tasks.
    - **`cron.ts`**: Cron expression parser for scheduling logic.
  - **`src/security/`**: Security and permission management.
    - **`permissions.ts`**: Defines command permissions and security checks.
  - **`src/services/`**: Additional services like transcription.
    - **`transcription.ts`**: Handles voice message transcription using OpenAI API.
  - **`src/skills/`**: Skill system for extending AI capabilities.
    - **`manager.ts`**: Manages loading and installing skills.
    - **`visual-art-skill.md`**: Example skill documentation or template.
  - **`src/ui/`**: User interface components for terminal output.
    - **`colors.ts`**: Color and formatting utilities for terminal output.
    - **`markdown.ts`**: Renders markdown to styled terminal output.
    - **`multilineInput.ts`**: Handles multi-line input with navigation and paste support.
    - **`pasteHandler.ts`**: Manages clipboard paste operations, including images.
    - **`spinner.ts`**: Displays loading spinners for long operations.
  - **`src/utils/`**: Miscellaneous utility functions.
    - **`processManager.ts`**: Manages background processes spawned by the application.
    - **`xml.ts`**: Utilities for cleaning XML tags from AI responses.
- **`dist/`**: Compiled output directory for the production build (e.g., `dist/slashbot` binary).
- **`docs/`**: Documentation directory (if present, not detailed in provided structure).
- **`scripts/`**: Potentially for build or utility scripts (not detailed in provided structure).
- **`node_modules/`**: Dependency directory managed by Bun.
- **`backend/`**: Unclear purpose, possibly for future server-side components or unrelated to the core CLI.

### Key Files
- **`src/index.ts`**: Main entry point of the application. Initializes the `Slashbot` class, sets up event listeners (e.g., SIGINT for graceful exit), and starts the CLI REPL (Read-Eval-Print Loop).
- **`src/constants.ts`**: Defines constants like file paths for configuration and history storage.
- **`src/errors.ts`**: Likely contains custom error classes or handling logic (not fully provided in snippets).
- **`src/updater.ts`**: Handles checking for and applying updates to Slashbot, including auto-update functionality.
- **`package.json`**: Defines project metadata, dependencies, scripts, and binary entry point (`bin.slashbot`).
- **`tsconfig.json`**: TypeScript configuration for compilation, targeting ESNext with strict type checking.
- **`eslint.config.js`**: ESLint configuration for linting, enforcing code quality with rules like unused import detection.
- **`.prettierrc`**: Prettier configuration for code formatting (e.g., single quotes, trailing commas).
- **`.gitignore`**: Ignores build artifacts, node modules, and local configuration files.

### Entry Points and Bootstrapping
- **Entry Point**: `src/index.ts` is the main entry point, invoked via `bun run src/index.ts` in development or as a compiled binary (`dist/slashbot`) in production.
- **Bootstrapping Process**:
  1. Checks for update commands (`update-check`, `--update`) and handles them first.
  2. Sets up process event listeners for graceful exit (SIGINT, SIGTERM) and error handling.
  3. Initializes the `Slashbot` class, which loads configuration, scheduler, skills, and connectors.
  4. Starts the Grok API client if an API key is available.
  5. Displays a banner with version and status information.
  6. Enters a REPL loop using `readMultilineInput` for user interaction.

### Where to Find Specific Types of Code
- **Routes/Commands**: Slash commands in `src/commands/parser.ts`.
- **API Clients**: Grok API client in `src/api/grok.ts`.
- **Models/Types**: Action types in `src/actions/types.ts`, configuration types in `src/config/config.ts`.
- **Utilities**: General utilities in `src/utils/`, UI utilities in `src/ui/`.
- **Connectors**: Platform integrations in `src/connectors/`.
- **File Operations**: Code editing and filesystem operations in `src/code/` and `src/fs/`.
- **UI Components**: Terminal output formatting in `src/ui/`.

---

## 5. CODE CONVENTIONS & STYLE

### Formatting Rules
- **Indentation**: 2 spaces (as per `.prettierrc` with `tabWidth: 2` and `useTabs: false`).
- **Line Length**: Maximum of 100 characters (per `printWidth` in `.prettierrc`).
- **Quotes**: Single quotes preferred (`singleQuote: true` in `.prettierrc`).
- **Semicolons**: Required (`semi: true` in `.prettierrc`).
- **Trailing Commas**: Added in multi-line structures (`trailingComma: "all"` in `.prettierrc`).
- **Bracket Spacing**: Spaces inside object literals (`bracketSpacing: true` in `.prettierrc`).
- **Arrow Parens**: Avoid parentheses for single-parameter arrow functions (`arrowParens: "avoid"`).

### Naming Conventions
- **Variables and Functions**: `camelCase` (e.g., `createGrokClient`, `handleInput`).
- **Classes**: `PascalCase` (e.g., `Slashbot`, `GrokClient`).
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `SYSTEM_PROMPT`, `HOME_SLASHBOT_DIR`).
- **File Names**: `kebab-case` for multi-word files (e.g., `multiline-input.ts`, `process-manager.ts`).
- **Interfaces and Types**: `PascalCase` with descriptive names (e.g., `ActionHandlers`, `TelegramConfig`).

### Import Ordering
- **No Explicit Order**: Imports are not strictly ordered in the codebase, but external dependencies (e.g., `discord.js`) are typically listed before internal imports (e.g., `./ui/colors`).
- **Unused Imports**: Automatically removed via ESLint rule (`unused-imports/no-unused-imports: 'error'`).

### Comment Style and Documentation Requirements
- **JSDoc Comments**: Used for major functions and classes to describe purpose and parameters (e.g., in `src/ui/markdown.ts` for `renderMarkdown`).
- **Inline Comments**: Used sparingly to explain complex logic or security considerations (e.g., in `src/index.ts` for action handlers).
- **Documentation**: README.md provides basic setup instructions, but detailed inline comments are preferred for code-specific documentation.

### Type Annotation Expectations
- **Strict Typing**: TypeScript is used with `strict: true` in `tsconfig.json`, enforcing type annotations for function parameters, return types, and variables where inference is insufficient.
- **Interface Usage**: Interfaces are defined for complex data structures (e.g., `ActionHandlers` in `src/actions/types.ts`).
- **Type Aliases**: Used for union types and simpler structures (e.g., `Action` in `src/actions/types.ts`).

### Error Handling Conventions
- **Try-Catch Blocks**: Used for operations prone to failure (e.g., API calls, file operations) with user-friendly error messages.
- **Non-Terminating Errors**: Errors are logged but do not crash the app (e.g., `process.on('uncaughtException')` in `src/index.ts`).
- **Custom Error Messages**: Errors are formatted with color (via `c.error`) and context to aid debugging.

---

## 6. HOW TO USE (for Developers)

### Installation Steps
1. **Install Bun**: Ensure Bun is installed as the runtime and package manager.
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. **Clone the Repository**: Get the source code.
   ```bash
   git clone <repo-url>
   cd slashbot
   ```
3. **Install Dependencies**: Use Bun to install required packages.
   ```bash
   bun install
   ```
4. **Build the Application** (optional for development, required for global installation):
   ```bash
   bun run build
   ```
5. **Install Globally** (optional, for system-wide access):
   ```bash
   bun run install-global
   ```

### Environment Setup
- **API Keys**: Slashbot requires a Grok API key from X.AI. It can be provided via:
  - Environment variables: `XAI_API_KEY` or `GROK_API_KEY`.
  - Command-line login: `slashbot login <api_key>`.
  - Interactive login: Run `slashbot` and use `/login` command.
- **Optional API Keys**:
  - `OPENAI_API_KEY`: For voice transcription support.
- **Configuration Storage**: API keys and settings are stored in `~/.slashbot/credentials.json` and `~/.slashbot/config.json`.
- **No `.env` File**: Environment variables are loaded directly from the system or interactively; no `.env` file is used by default.

### Running in Development Mode
- **Command**: Start the application in development mode with hot reloading.
  ```bash
  bun run dev
  ```
- **Behavior**: Runs `src/index.ts` directly using Bun, allowing for quick iteration during development.

### Running Tests
- **Command**: Run type checking (no explicit test command in `package.json` for Vitest, but type checking is available).
  ```bash
  bun run typecheck
  ```
- **Note**: Testing setup with Vitest is present in dependencies, but no explicit test scripts or files are provided in the structure. Add test files in `src/` and update `package.json` scripts if needed.

### Building for Production
- **Command**: Compile the application into a standalone binary.
  ```bash
  bun run build
  ```
- **Output**: Generates `dist/slashbot`, a minified binary for distribution or global installation.

### Deployment Process
- **Global Installation**: After building, install the binary globally for system-wide access.
  ```bash
  bun run install-global
  ```
- **Running**: Execute the binary directly.
  ```bash
  slashbot
  ```
- **No Server Deployment**: Slashbot is a CLI tool, not a server application, so deployment is limited to distributing the binary or running locally.

---

## 7. HOW TO DEVELOP & EXTEND

### Adding New Features: Where to Put New Code
- **Core Logic**: Add to `src/index.ts` within the `Slashbot` class for application-wide features.
- **New Actions**: Define in `src/actions/types.ts` and implement parsing in `src/actions/parser.ts` and execution in `src/actions/executor.ts`.
- **UI Enhancements**: Add to `src/ui/` for terminal output or input handling (e.g., new formatting in `markdown.ts`).
- **Connectors**: Create new platform integrations in `src/connectors/` following the pattern of `telegram.ts` or `discord.ts`.
- **Skills**: Add to `src/skills/` or allow users to install via `<skill-install>` action for AI capability extensions.

### Adding New API Endpoints: Step-by-Step
Slashbot interacts with external APIs (e.g., Grok API) rather than exposing its own. To add a new external API integration:
1. **Create API Client**: Add a new file in `src/api/` (e.g., `newapi.ts`) with a client class similar to `GrokClient`.
   ```typescript
   export class NewApiClient {
     constructor(apiKey: string) {
       // Initialize with API key
     }
     async request(endpoint: string, data: any): Promise<any> {
       // Implement API call
     }
   }
   ```
2. **Integrate with Slashbot**: Update `src/index.ts` to initialize and pass the client to the `CommandContext`.
3. **Add Actions**: Define related actions in `src/actions/types.ts` and handle them in `src/actions/executor.ts`.
4. **Update System Prompt**: Modify `SYSTEM_PROMPT` in `src/api/grok.ts` to inform the AI about the new API capabilities.

### Adding New Components/Modules: Conventions
- **File Location**: Place in the appropriate `src/` subdirectory based on purpose (e.g., `src/services/` for new services).
- **Naming**: Use `kebab-case` for filenames (e.g., `new-service.ts`) and `PascalCase` for class names (e.g., `NewService`).
- **Export**: Export a factory function (e.g., `createNewService()`) for consistency with existing patterns.
- **Integration**: Wire into `Slashbot` class in `src/index.ts` and update `CommandContext` if needed.

### Database Changes: Migration Workflow
- **No Database**: Slashbot does not use a traditional database. Configuration and state are file-based in `~/.slashbot/`.
- **File-Based Changes**: If extending with persistent data, update `src/config/config.ts` to handle new file formats or structures. Ensure backward compatibility by checking for existing data before overwriting.

### Testing: How to Write and Run Tests
- **Framework**: Use Vitest for unit testing (already a dependency).
- **Test Location**: Place test files alongside source files or in a `tests/` directory (e.g., `src/api/grok.test.ts`).
- **Writing Tests**: Follow Vitest syntax for tests.
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { someFunction } from '../someModule';

  describe('someFunction', () => {
    it('should do something', () => {
      expect(someFunction()).toBe('expected result');
    });
  });
  ```
- **Running Tests**: Add a test script to `package.json` if not present.
  ```json
  "scripts": {
    "test": "vitest run"
  }
  ```
  Then run:
  ```bash
  bun run test
  ```

---

## 8. COMMON TASKS & PATTERNS

### Common Operations with Code Examples
- **Starting a Conversation**: Simply type a message or command after launching `slashbot`.
  ```bash
  slashbot
  # Type: "Help me debug this code"
  ```
- **Executing Bash Commands via AI**: Request the AI to run a command.
  ```xml
  <bash>ls -la</bash>
  ```
  Parsed and executed by `src/actions/executor.ts`.
- **Reading a File**: AI can read file contents for context.
  ```xml
  <read path="src/index.ts"/>
  ```
- **Editing a File**: AI can modify files with search-and-replace.
  ```xml
  <edit path="src/index.ts">
    <search>oldFunction()</search>
    <replace>newFunction()</replace>
  </edit>
  ```

### How to Handle Authentication
- **API Key Login**: Authenticate with Grok API using the `/login` command or CLI argument.
  ```bash
  slashbot login <your-api-key>
  ```
- **Storage**: API keys are stored in `~/.slashbot/credentials.json` by `ConfigManager` in `src/config/config.ts`.
- **Security**: Keys are not hardcoded or exposed in logs; they are loaded from environment variables or secure storage.

### How to Interact with the Database
- **No Database**: Slashbot uses file-based storage in `~/.slashbot/`.
- **Configuration Access**: Use `ConfigManager` in `src/config/config.ts` to read/write settings.
  ```typescript
  const configManager = createConfigManager();
  await configManager.load();
  const apiKey = configManager.getApiKey();
  ```

### How to Add/Modify UI Components
- **Terminal Output**: Extend `src/ui/` modules like `colors.ts` or `markdown.ts` for new formatting.
  ```typescript
  // Add to src/ui/colors.ts
  export const newStyle = `\x1b[38;5;208m`; // Orange color
  ```
- **Input Handling**: Modify `src/ui/multilineInput.ts` for new input behaviors (e.g., custom key bindings).
- **Rendering**: Update `banner` function in `src/ui/colors.ts` to change the startup display.

### How to Add New CLI Commands
- **Define Command**: Add to `parseInput` function in `src/commands/parser.ts`.
  ```typescript
  if (input === '/newcommand') {
    return { isCommand: true, command: 'newcommand', args: [] };
  }
  ```
- **Implement Logic**: Add execution logic in `executeCommand` function.
  ```typescript
  if (parsed.command === 'newcommand') {
    console.log(c.success('New command executed!'));
    return;
  }
  ```
- **Document**: Update help text in the same file or in `SYSTEM_PROMPT` in `src/api/grok.ts`.

---

## 9. DEPENDENCIES & EXTERNAL SERVICES

### Database Requirements
- **None**: Slashbot does not use a database. Configuration and history are stored in JSON files under `~/.slashbot/`.

### API Keys Needed
- **Grok API Key**: Required for AI functionality. Obtained from `https://console.x.ai/`. Set via environment variable (`XAI_API_KEY` or `GROK_API_KEY`) or interactively with `/login`.
- **OpenAI API Key**: Optional for voice transcription. Set via `OPENAI_API_KEY` or `/openai` command (if implemented).

### External Services Integration
- **Grok API (X.AI)**: Core AI service for chat and action execution. Configured in `src/api/grok.ts` with a base URL of `https://api.x.ai/v1`.
- **Telegram**: Bot integration for messaging and notifications. Requires bot token and chat ID, configured via `src/connectors/telegram.ts`.
- **Discord**: Similar bot integration for messaging. Requires bot token and channel ID, configured via `src/connectors/discord.ts`.
- **OpenAI API**: Used for voice transcription in `src/services/transcription.ts` if an API key is provided.

### Docker/Container Requirements
- **None**: Slashbot is a standalone CLI tool with no Docker configuration or containerization provided in the codebase. Developers can create a Dockerfile if needed for isolated environments.

---

## 10. GOTCHAS & IMPORTANT NOTES

### Non-Obvious Behaviors
- **Agentic Loop**: The AI continues iterating on tasks until no actions remain, which may lead to unexpected long-running operations. Monitor output or use Ctrl+C to abort.
- **Context Compression**: Enabled by default in `GrokClient`, limiting conversation history to 200 messages to save tokens. This may cause loss of earlier context unless disabled.
- **Duplicate Read Prevention**: The application filters out repeated file read actions to prevent AI from getting stuck in loops, injecting corrections if needed.

### Performance Considerations
- **Token Usage**: Large conversation histories or frequent API calls can consume significant tokens. Monitor usage with `getUsage()` in `GrokClient`.
- **Background Processes**: Managed via `processManager` in `src/utils/processManager.ts`. Too many background tasks can impact system resources; use `/ps` and `/kill` to manage.
- **API Timeouts**: Configurable in action handlers (e.g., `bash` timeout), with defaults to prevent hanging. Adjust if long-running tasks are expected.

### Security Considerations
- **API Key Storage**: Keys are stored in plaintext in `~/.slashbot/credentials.json`. Ensure file permissions are restricted (e.g., `chmod 600`).
- **Command Blocking**: Dangerous commands (e.g., `rm -rf /`) are blocked by `scheduler.validateCommand` in `src/index.ts`. Review `onBash` handler for security rules.
- **Connector Locks**: Prevents multiple instances of Telegram/Discord connectors using lock files in `~/.slashbot/locks/`, avoiding conflicts.

### Breaking Changes History
- **Version 1.1.0**: Introduced auto-update, process management, and connector improvements (commit `ee974e9`). Ensure updates are tested in a safe environment as they may restart the application.
- **Legacy Aliases**: Actions like `<exec>` and `<create>` are aliases for `<bash>` and `<write>` for backward compatibility. Use modern forms in new code.

### Known Issues or Limitations
- **No Database**: Limits scalability for complex state management. Consider adding a lightweight database if persistent data grows.
- **API Dependency**: Reliant on Grok API availability. Downtime or rate limits can halt functionality.
- **Testing Gaps**: No explicit test suite or coverage reports in the provided structure. Add tests for robustness.

---

## 11. COMMAND REFERENCE

### NPM/Bun Scripts with Descriptions
- **`bun run dev`**: Runs the application in development mode using Bun, executing `src/index.ts` directly.
- **`bun run build`**: Compiles the application into a minified binary at `dist/slashbot` for production use.
- **`bun run install-global`**: Builds the application and copies the binary to `/usr/local/bin/slashbot` for global access (requires sudo).
- **`bun run start`**: Runs the compiled binary from `dist/slashbot`.
- **`bun run tsc`**: Runs the TypeScript compiler (likely for type checking or compilation).
- **`bun run typecheck`**: Performs type checking without emitting code, using `tsc --noEmit`.

### CLI Commands
- **`slashbot`**: Starts the Slashbot CLI for interactive use.
- **`slashbot login <api_key>`**: Logs in with a Grok API key, saving it to `~/.slashbot/credentials.json`.
- **`slashbot update-check` or `slashbot --check-update`**: Checks for updates without applying them.
- **`slashbot --update` or `slashbot -u`**: Updates Slashbot to the latest version and restarts.
- **`slashbot --version` or `slashbot -v`**: Displays the current version of Slashbot.
- **`slashbot --help` or `slashbot -h`**: Shows usage and command help.

### Common Development Commands
- **Interactive Commands**: Available within the Slashbot REPL after starting the application.
  - **`/login`**: Prompts for Grok API key input if not provided via CLI.
  - **`/logout`**: Clears the saved API key.
  - **`/task`**: Manages scheduled tasks (e.g., list, add, remove).
  - **`/notify`**: Configures notifications for external platforms.
  - **`/help`**: Displays all available commands.
  - **`/exit`**: Quits the application.
  - **`/ps`**: Lists running background processes.
  - **`/kill <id>`**: Stops a specific background process by ID.
- **Quick Help**: Typing `?` in the REPL is a shortcut for `/help`.

---

This `GROK.md` file is designed to be a living document for Slashbot, providing all necessary information for developers and AI assistants to engage with the project. If you have additional questions or need further clarification, refer to the inline comments in the code or reach out to the project maintainers.