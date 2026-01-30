# GROK.md

## Project Name and Description

**Project Name:** Slashbot  
**Description:** Slashbot is a lightweight CLI assistant powered by the Grok API from X.AI. It serves as an alternative to tools like Claude Code, providing features for code editing, file management, and AI-driven interactions in the terminal. Version: 1.0.5.

## Tech Stack

- **Runtime:** Bun (used for execution and building).  
- **Language:** TypeScript (with strict mode enabled).  
- **Linting and Formatting:** ESLint (for code quality), Prettier (for formatting), and Biome (inferred from configs).  
- **Dependencies:** Key libraries include clipboardy (clipboard operations), dotenv (environment variables), telegraf (Telegram integration), and terminal-image (image handling).  
- **Dev Dependencies:** @types/bun, @types/node, and typescript.  
- **APIs and Tools:** X.AI Grok API for AI interactions, GitHub API for updates, and various Node.js modules for file system, scheduling, and notifications.

## Project Structure

- **docs/**: Contains documentation files, such as this GROK.md.  
- **scripts/**: Scripts for utility tasks, like updates.  
- **.claude/**: Possibly for configuration or cached data related to AI interactions.  
- **src/**: Core source code directory, including:  
  - **src/code/**: Handles code-related operations like image buffering and editing.  
  - **src/utils/**: Utility functions for general tasks.  
  - **src/ui/**: Manages terminal UI elements, colors, and prompts.  
  - **src/notify/**: Notification handling for services like Telegram and WhatsApp.  
  - **src/skills/**: Custom skills or plugins for extended functionality.  
  - **src/config/**: Configuration management, including API keys.  
  - **src/security/**: Security checks for commands and file operations.  
  - **src/scheduler/**: Task scheduling and automation.  
  - **src/fs/**: File system interactions.  
  - **src/actions/**: Action parsing and execution.  
  - **src/commands/**: Command parsing and handling.  
  - **src/api/**: API clients, including Grok API integration.  
  - **src/index.ts:** Main entry point.  
- **dist/**: Output directory for built binaries.

## Commands

- **Development Commands (from package.json scripts):**  
  - `npm run dev`: Runs the application in development mode using `bun run src/index.ts`.  
  - `npm run build`: Compiles and minifies the code with `bun build --compile --minify src/index.ts --outfile dist/slashbot`.  
  - `npm run start`: Executes the built binary with `./dist/slashbot`.  
  - `npm run tsc`: Runs the TypeScript compiler.  
  - `npm run typecheck`: Performs TypeScript type checking without emitting output.  

- **In-App CLI Commands:**  
  - `/login`: Enters your Grok API key.  
  - `/logout`: Logs out or clears API key.  
  - `/task`: Manages scheduled tasks.  
  - `/notify`: Configures notification services.  
  - `/help`: Displays available commands.  
  - `/exit`: Quits the application.  
  - Natural language queries: Sent to Grok for processing, supporting actions like [[grep]], [[edit]], etc.

## Architecture

Slashbot follows a modular architecture designed for CLI AI interactions:  
- **Core Components:**  
  - **GrokClient (in src/api/grok.ts):** Handles API calls to X.AI, including streaming responses, vision support, and an agentic loop for iterative actions (e.g., execute one action, observe results, and continue).  
  - **Command Handling:** Parses user input in src/index.ts and routes it to either built-in commands or Grok for AI processing.  
  - **Action System:** Supports custom actions (e.g., grep, read, edit, exec) via a plugin-like system, with security checks to prevent destructive operations.  
- **Key Patterns:**  
  - Agentic Loop: Processes responses iteratively, feeding results back to Grok for context-aware continuations.  
  - Event Handling: Uses Node.js events (e.g., SIGINT, unhandled exceptions) to ensure graceful operation.  
  - Dependency Injection: Components like FileSystem and Notifier are created and passed as needed for modularity.  
- **Overall Organization:** The app is structured around a REPL (Read-Eval-Print Loop) in src/index.ts, with modules for specific functionalities to keep concerns separated.

## Code Conventions

- **Styling Rules (from Prettier):**  
  - Line width: 100 characters.  
  - Use single quotes for strings.  
  - Add trailing commas for all elements.  
  - Tab width: 2 spaces, no tabs.  
  - Bracket spacing: Enabled.  
  - Arrow function parentheses: Avoid when possible.  

- **Patterns Observed (from ESLint):**  
  - Enforce no unused imports or variables (e.g., 'unused-imports/no-unused-imports' set to error).  
  - Prevent floating promises and misused promises for async safety.  
  - Use nullish coalescing where appropriate.  
  - General rules: Strict TypeScript enforcement, with options like 'strict: true' in tsconfig.json.  
  - Code is concise, token-efficient, and follows a functional style with clear error handling.

## Key Files

- **src/index.ts:** Main entry point; sets up the REPL, handles user input, initializes components like GrokClient, and manages the application lifecycle.  
- **src/api/grok.ts:** Implements the Grok API client, including chat functionality, action parsing, streaming responses, and usage tracking. Key features: Agentic loop for multi-step interactions, vision support, and personality modes (normal, depressed, sarcasm).  
- **src/commands/parser.ts:** Parses and executes CLI commands, providing tab completion.  
- **src/config/config.ts:** Manages configuration, including loading and saving API keys from .env files.  
- **src/ui/colors.ts:** Handles terminal UI elements like colors, banners, and prompts for a user-friendly interface.  
- **src/updater.ts:** Checks for application updates via GitHub API.  
- **.env.example:** Defines environment variables, such as XAI_API_KEY for Grok access and TELEGRAM_BOT_TOKEN for notifications.

## Development Notes

- **Useful Info for AI Assistants:**  
  - **Environment Variables:** Required for operation; set XAI_API_KEY or GROK_API_KEY for API access. Optional ones include TELEGRAM_BOT_TOKEN for notifications and WHATSAPP_ACCESS_TOKEN for WhatsApp integration. Use dotenv to load them.  
  - **Setup and Running:** Install dependencies with `bun install`, then use `npm run dev` for development. Ensure Bun is installed as it's the runtime.  
  - **Testing and Debugging:** Run `npm run typecheck` for TypeScript errors. The agentic loop in GrokClient allows for iterative fixes, e.g., handle build failures automatically.  
  - **Security Considerations:** Commands are vetted via CommandPermissions; avoid running destructive actions without user confirmation.  
  - **Extending the Codebase:** Add new skills in src/skills/ or actions in src/actions/. Follow existing patterns for async operations and error handling.  
  - **Performance Tips:** The system is token-conscious; keep responses minimal. Use context compression in GrokClient for long conversations.  
  - **Common Pitfalls:** Ensure API keys are handled securely; watch for aborted requests during streaming. If working on this codebase, prioritize testing in a Bun environment.