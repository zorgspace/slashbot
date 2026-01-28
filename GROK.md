# GROK.md

## Project Name and Description

**Project Name:** Slashbot  
**Description:** Slashbot is a lightweight CLI assistant powered by the Grok API from x.ai. It serves as an alternative to tools like Claude Code, providing AI-assisted coding, task automation, and terminal interactions. Version: 1.0.4.

## Tech Stack

- **Languages:** TypeScript (with Bun runtime for execution).  
- **Frameworks and Libraries:**  
  - Grok API (for AI interactions).  
  - Readline (for terminal input).  
  - Telegraf (for Telegram integration).  
  - Clipboardy (for clipboard operations).  
  - Dotenv (for environment variable management).  
  - Terminal-image (for image handling in terminal).  
- **Tools:**  
  - ESLint (for linting).  
  - Prettier (for code formatting).  
  - TypeScript Compiler (tsc) for type checking.  
  - Bun for building and running the application.

## Project Structure

- **Root Directory (.):** Contains main configuration files like package.json, .gitignore, and .env.example.  
- **scripts:** Custom scripts for build processes or utilities.  
- **.claude:** Possibly stores project-specific context or configuration files.  
- **src:** Core source code.  
  - **src/code:** Handles code-related utilities, e.g., image buffer and code editing.  
  - **src/utils:** General utility functions, such as XML parsing.  
  - **src/ui:** Manages terminal UI elements like colors and prompts.  
  - **src/notify:** Notification services (e.g., Telegram, WhatsApp).  
  - **src/skills:** Implements AI skills for context gathering.  
  - **src/config:** Manages configuration, including API keys.  
  - **src/security:** Handles permissions and command validation.  
  - **src/scheduler:** Task scheduling functionality.  
  - **src/fs:** File system operations.  
  - **src/actions:** Defines and executes actions like file edits or commands.  
  - **src/commands:** Parses and executes CLI commands.  
  - **src/api:** API clients, including Grok API integration.  
  - **src/index.ts:** Main entry point for the application.  
- **dist:** Output directory for built binaries.

## Commands

- **dev:** `bun run src/index.ts` - Runs the application in development mode for interactive testing.  
- **build:** `bun build --compile --minify src/index.ts --outfile dist/slashbot` - Compiles and minifies the code into a distributable binary.  
- **start:** `./dist/slashbot` - Starts the built application.  
- **tsc:** `tsc` - Compiles TypeScript code.  
- **typecheck:** `tsc --noEmit -p tsconfig.json` - Performs type checking without emitting output.

## Architecture

Slashbot is organized as a modular CLI application using an agentic loop for AI interactions. Key patterns include:  
- **Entry Points:** Starts from src/index.ts, which sets up the REPL (Read-Eval-Print Loop) and initializes components.  
- **Modular Design:** Components like GrokClient, FileSystem, Notifier, and Scheduler are instantiated and wired together for extensibility.  
- **AI-Driven Workflow:** Uses Grok API for streaming responses, action parsing (e.g., <grep>, <edit>), and iterative processing. The agentic loop allows the AI to execute actions, handle results, and refine responses.  
- **Security and Error Handling:** Implements safeguards like command validation, abort mechanisms for operations, and error catching to prevent crashes.  
- **Context Management:** Maintains conversation history, compresses context for efficiency, and loads project-specific files (e.g., GROK.md) for AI context.

## Code Conventions

- **Styling Rules (from Prettier):**  
  - Line width: 100 characters.  
  - Use semicolons.  
  - Single quotes for strings.  
  - Trailing commas for all elements.  
  - 2-space indentation (no tabs).  
  - Bracket spacing and minimal arrow parens.  
- **Linting Rules (from ESLint):**  
  - Enforces recommended JS and TS rules.  
  - Warns on unused imports/variables (with patterns like ^_ for ignored vars).  
  - Errors on floating promises and misused promises.  
  - Promotes nullish coalescing for better null handling.  
- **General Patterns:** Observed in code samples include type safety, async generators for streaming, and modular exports for reusability.

## Key Files

- **src/index.ts:** Main entry point; sets up the CLI interface, handles user input, initializes GrokClient, and manages the application lifecycle.  
- **src/api/grok.ts:** Implements the Grok API client; handles chat streaming, action execution, and configuration. Key features include:  
  - Streaming responses for real-time interactions.  
  - Vision support for image inputs.  
  - Agentic loop for iterative tasks.  
- **src/commands/parser.ts:** Parses user input into commands or natural language queries.  
- **src/utils/xml.ts:** Utilities for parsing and cleaning XML-like action tags.  
- **src/code/editor.ts:** Manages code editing operations like searching, reading, and modifying files.  
- **package.json:** Defines dependencies, scripts, and project metadata.

## Development Notes

- **Useful Info for AI Assistants:**  
  - **Configuration Options (from src/api/grok.ts):**  
    - API Key: Required via environment variables (GROK_API_KEY or XAI_API_KEY).  
    - Model: Defaults to 'grok-4-1-fast-reasoning'; can be overridden.  
    - Base URL: Defaults to 'https://api.x.ai/v1'.  
    - Temperature: Controls response creativity (default: 0.7).  
    - Max Tokens: Limits response length (default: 8192).  
    - Enable context compression for long conversations.  
  - **Usage Examples:**  
    - Create a Grok client: `const client = createGrokClient(process.env.GROK_API_KEY);`.  
    - Send a chat message: `await client.chat('Explain this code');`.  
    - Handle actions: Use methods like `onGrep`, `onEdit` for file operations.  
    - Streaming: `for await (const chunk of client.chatStream(messages)) { console.log(chunk); }`.  
  - **Features:**  
    - Supports vision mode for image inputs.  
    - Agentic loop for auto-fixing errors (e.g., build checks).  
    - Personalities: Switch between 'normal', 'depressed', or 'sarcastic' modes.  
  - **Environment Variables:**  
    - XAI_API_KEY: Primary API key.  
    - GROK_API_KEY: Alternative API key.  
    - TELEGRAM_BOT_TOKEN: For Telegram notifications.  
    - WHATSAPP_ACCESS_TOKEN: For WhatsApp integration.  
    - Others: XAI_OAUTH_CLIENT_ID, etc., for optional OAuth.  
  - **Best Practices:**  
    - Always use <skill name="init"> on unfamiliar projects to analyze codebase.  
    - Test with `bun run dev` and ensure type safety with `bun run typecheck`.  
    - Handle errors gracefully; avoid destructive commands without confirmation.  
    - For updates, focus on modular components and run builds to verify changes.