#!/usr/bin/env bun
/**
 * Slashbot - Lightweight CLI Assistant powered by Grok
 * A Claude Code-inspired terminal assistant using X.AI's Grok API.
 */

import * as readline from 'readline';

import { banner, inputPrompt, inputClose, responseStart, c, errorBlock, colors } from './ui/colors';

if (process.argv[2] === 'update-check') {
  const updater = await import('./updater') as any;
  const checkForUpdate = updater.checkForUpdate as (notifier?: any) => Promise<void>;
  await checkForUpdate();
  process.exit(0);
}

let lastCtrlC = 0;
let currentBot: Slashbot | null = null;

// Prevent accidental exit - require double Ctrl+C
process.on('SIGINT', () => {
  const now = Date.now();

  // Check if currently thinking/processing
  const wasThinking = currentBot?.isThinking() ?? false;

  if (wasThinking) {
    // Abort current operation and show prompt immediately
    currentBot?.abortCurrentOperation();
    // Clear the line and show prompt
    process.stdout.write('\r\x1b[K'); // Clear current line
    process.stdout.write(inputClose() + inputPrompt());
    lastCtrlC = 0; // Reset so next Ctrl+C shows warning instead of exiting
    return;
  }

  // Not thinking - handle double Ctrl+C to exit
  if (now - lastCtrlC < 500) {
    console.log(c.violet('\n\nSee you soon!'));
    // Stop the bot (and scheduler) before exiting
    currentBot?.stop();
    process.exit(0);
  }
  lastCtrlC = now;
});

// Prevent SIGTERM from killing the app immediately
process.on('SIGTERM', () => {
  console.log(c.warning('\nReceived SIGTERM - use /exit or Ctrl+C twice to quit'));
});

// Clean up on exit
process.on('exit', () => {
  currentBot?.stop();
});

// Prevent uncaught exceptions from crashing
process.on('uncaughtException', (err) => {
  console.log(c.error(`\nError: ${err.message}`));
  // Don't exit - keep running
});

// Prevent unhandled promise rejections from crashing
process.on('unhandledRejection', (reason) => {
  console.log(c.error(`\nError: ${reason}`));
  // Don't exit - keep running
});

const VERSION = process.env.SLASHBOT_VERSION || "dev";

if (process.argv.some(arg => arg === '--version' || arg === '-v')) {
  console.log(`slashbot v${VERSION}`);
  process.exit(0);
}



import { createGrokClient, GrokClient } from './api/grok';
import { parseInput, executeCommand, CommandContext, completer } from './commands/parser';
import { createFileSystem, SecureFileSystem } from './fs/filesystem';
import { createScheduler, TaskScheduler } from './scheduler/scheduler';
import { createConfigManager, ConfigManager } from './config/config';
import { createCodeEditor, CodeEditor } from './code/editor';
import { createCommandPermissions, CommandPermissions } from './security/permissions';
import { addImage, imageBuffer } from './code/imageBuffer';



interface SlashbotConfig {
  basePath?: string;
}

class Slashbot {
  private grokClient: GrokClient | null = null;
  private fileSystem: SecureFileSystem;
  private scheduler: TaskScheduler;
  private configManager: ConfigManager;
  private codeEditor: CodeEditor;
  private commandPermissions: CommandPermissions;
  private rl: readline.Interface | null = null;
  private running = false;
  private history: string[] = [];
  private historyIndex = -1;
  private loadedContextFile: string | null = null;

  constructor(config: SlashbotConfig = {}) {
    this.fileSystem = createFileSystem(config.basePath);
    this.scheduler = createScheduler();
    this.configManager = createConfigManager();
    this.codeEditor = createCodeEditor(config.basePath);
    this.commandPermissions = createCommandPermissions();
  }

  private getContext(): CommandContext {
    return {
      grokClient: this.grokClient,
      scheduler: this.scheduler,
      fileSystem: this.fileSystem,
      configManager: this.configManager,
      codeEditor: this.codeEditor,
      reinitializeGrok: () => this.initializeGrok(),
    };
  }

  abortCurrentOperation(): void {
    if (this.grokClient) {
      this.grokClient.abort();
    }
  }

  isThinking(): boolean {
    return this.grokClient?.isThinking() ?? false;
  }

  private async initializeGrok(): Promise<void> {
    const apiKey = this.configManager.getApiKey();
    if (apiKey) {
      try {
        this.grokClient = createGrokClient(apiKey);

        // Load context file if exists (CLAUDE.md, GROK.md, or SLASHBOT.md)
        const workDir = this.codeEditor.getWorkDir();
        const contextFileNames = ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md'];
        let contextLoaded = false;

        for (const fileName of contextFileNames) {
          const contextFilePath = `${workDir}/${fileName}`;
          const contextFile = Bun.file(contextFilePath);

          if (await contextFile.exists()) {
            try {
              const contextContent = await contextFile.text();
              this.grokClient.setProjectContext(contextContent, workDir);
              this.loadedContextFile = fileName;
              contextLoaded = true;
              break;
            } catch {
              // Ignore read errors, try next file
            }
          }
        }

        if (!contextLoaded && await this.codeEditor.isAuthorized()) {
          // Fallback: inject basic project context if authorized but no SLASHBOT.md
          const files = await this.codeEditor.listFiles();
          const context = `Directory: ${workDir}\nFiles:\n${files.slice(0, 50).join('\n')}`;
          this.grokClient.setProjectContext(context, workDir);
        }

        // Wire up action handlers
        this.grokClient.setActionHandlers({
          onSchedule: async (cron, command, name) => {
            await this.scheduler.addTask(name, cron, command);
          },

          onFile: async (path, content) => {
            return await this.fileSystem.writeFile(path, content);
          },

          // Code editing handlers
          onGrep: async (pattern, filePattern) => {
            const results = await this.codeEditor.grep(pattern, filePattern);
            if (results.length === 0) {
              return 'No results';
            }
            return results.map(r => `${r.file}:${r.line}: ${r.content}`).join('\n');
          },

          onRead: async (path) => {
            return await this.codeEditor.readFile(path);
          },

          onEdit: async (path, search, replace) => {
            return await this.codeEditor.editFile({ path, search, replace });
          },

          onCreate: async (path, content) => {
            return await this.codeEditor.createFile(path, content);
          },

          onExec: async (command) => {
            const workDir = this.codeEditor.getWorkDir();

            // Security check via scheduler
            const security = this.scheduler.validateCommand(command);
            if (security.blocked) {
              console.log(c.error(`[SECURITY] Command blocked: ${security.blockedReason}`));
              return `Command blocked: ${security.blockedReason}`;
            }
            if (security.warnings.length > 0) {
              security.warnings.forEach(w => console.log(c.warning(`[SECURITY] ${w}`)));
            }

            // Check if command was denied this session
            if (this.commandPermissions.isDeniedThisSession(command, workDir)) {
              return 'Command refused by user';
            }

            // Check if command is already allowed
            if (!this.commandPermissions.isAllowed(command, workDir)) {
              // Prompt user for approval
              const result = await this.commandPermissions.promptForApproval(command, workDir);

              if (result === 'no') {
                this.commandPermissions.denyForSession(command, workDir);
                console.log(c.muted('Command refused'));
                return 'Command refused by user';
              }

              if (result === 'always') {
                await this.commandPermissions.addPermission(command, workDir);
                const cmdBase = command.split(' ')[0];
                console.log(c.success(`'${cmdBase}' authorized in this directory`));
              }
            }

            // Execute the command
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              const { stdout, stderr } = await execAsync(command, {
                cwd: workDir,
                timeout: 30000,
              });
              return stdout || stderr || 'Command executed';
            } catch (error: any) {
              return `Error: ${error.message || error}`;
            }
          },

          onBuildCheck: async () => {
            // Try to run TypeScript check or build
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);

              // Try bun check first, then tsc
              try {
                await execAsync('bun run tsc --noEmit 2>&1', {
                  cwd: this.codeEditor.getWorkDir(),
                  timeout: 60000,
                });
                return { success: true, errors: [] };
              } catch (error: any) {
                const output = error.stdout || error.stderr || error.message || '';
                const errors = output.split('\n')
                  .filter((line: string) => line.includes('error') || line.includes('TS'))
                  .slice(0, 10);
                return { success: false, errors };
              }
            } catch {
              return { success: true, errors: [] }; // Can't check, assume ok
            }
          },
        });
      } catch {
        this.grokClient = null;
      }
    } else {
      this.grokClient = null;
    }
  }

  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();

    if (!trimmed) return;

    // Handle ? shortcut for help
    if (trimmed === '?') {
      const parsed = await parseInput('/help');
      await executeCommand(parsed, this.getContext());
      return;
    }

    // Handle pasted images directly into buffer
    const imageMatch = trimmed.match(/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/i);
    if (imageMatch) {
      addImage(trimmed);
      console.log(`${c.success('🖼️  Image pasted to buffer #')}${imageBuffer.length}`);
      return;
    }

    const parsed = await parseInput(trimmed);

    // Handle slash commands
    if (parsed.isCommand) {
      await executeCommand(parsed, this.getContext());
      return;
    }

    // Handle natural language - send to Grok
    if (!this.grokClient) {
      console.log(c.warning('Not connected to Grok'));
      console.log(c.muted('  Use /login to enter your API key'));
      console.log(inputClose());
      return;
    }

    try {
      await this.grokClient.chat(trimmed);
      console.log(inputClose());
    } catch (error) {
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(inputClose());
        return;
      }
      console.log(errorBlock(error instanceof Error ? error.message : String(error)));
      console.log(inputClose());
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const historyPath = `${process.env.HOME}/.config/slashbot/history`;
      const file = Bun.file(historyPath);
      if (await file.exists()) {
        const content = await file.text();
        this.history = content.split('\n').filter(line => line.trim());
      }
    } catch {
      // No history file yet
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      const { mkdir } = await import('fs/promises');
      const configDir = `${process.env.HOME}/.config/slashbot`;
      await mkdir(configDir, { recursive: true });

      // Keep last 500 commands
      const historyToSave = this.history.slice(-500);
      await Bun.write(`${configDir}/history`, historyToSave.join('\n'));
    } catch {
      // Ignore save errors
    }
  }

  async start(): Promise<void> {
    // Load configuration
    await this.configManager.load();

    // Initialize scheduler (load persisted tasks)
    await this.scheduler.init();

    // Initialize code editor
    await this.codeEditor.init();

    // Initialize command permissions
    await this.commandPermissions.load();

    // Load command history
    await this.loadHistory();

    // Initialize Grok client if API key available
    await this.initializeGrok();

    // Start scheduler
    this.scheduler.start();

    // Display banner with all info
    const tasks = this.scheduler.listTasks();
    const isCodeAuthorized = await this.codeEditor.isAuthorized();
    console.log(banner({
      version: VERSION,
      workingDir: this.codeEditor.getWorkDir(),
      contextFile: this.loadedContextFile,
      tasksCount: tasks.length,
      isAuthorized: isCodeAuthorized,
    }));

    // Create readline interface with history and autocomplete support
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      history: this.history.slice(-100).reverse(), // Load last 100 commands (reversed for readline)
      historySize: 100,
      removeHistoryDuplicates: true,
      completer: completer, // Tab autocomplete for /commands
    });

    // Set scheduler callback to redraw prompt after task execution
    this.scheduler.setOnTaskComplete(() => {
      if (this.running && this.rl) {
        process.stdout.write(inputPrompt());
      }
    });

    this.running = true;

    // Handle line input
    const askQuestion = (): void => {
      if (!this.running || !this.rl) return;

      this.rl.question(inputPrompt(), async (answer) => {
        // Skip empty input
        if (!answer.trim()) {
          askQuestion();
          return;
        }

        // Add to history if not duplicate of last
        if (answer.trim() !== this.history[this.history.length - 1]) {
          this.history.push(answer.trim());
          await this.saveHistory();
        }

        await this.handleInput(answer);
        askQuestion();
      });
    };

    // Handle readline close (Ctrl+D) - recreate interface instead of exiting
    this.rl.on('close', () => {
      if (!this.running) return;

      // Clear the rl reference first to prevent scheduler callback from using closed interface
      this.rl = null;

      console.log(c.warning('\nCtrl+D pressed - use /exit or Ctrl+C twice to quit'));

      // Recreate readline interface
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        history: this.history.slice(-100).reverse(),
        historySize: 100,
        removeHistoryDuplicates: true,
        completer: completer,
      });

      // Re-attach close handler
      this.rl.on('close', () => {
        if (this.running) {
          console.log(c.warning('\nUse /exit or Ctrl+C twice to quit'));
        }
      });

      // Resume asking questions
      askQuestion();
    });

    // Start the REPL
    askQuestion();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.scheduler.stop();
    await this.saveHistory();
    this.rl?.close();
  }
}

// CLI Entry Point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.violet('Slashbot')} - CLI Assistant powered by Grok

${c.bold('Usage:')}
  slashbot [options]
  slashbot login              Enter API key

${c.bold('Options:')}
  -h, --help      Show this help
  -v, --version   Show version

${c.bold('Commands:')}
  /login          Enter Grok API key
  /logout         Log out
  /task           Manage scheduled tasks
  /notify         Configure notifications
  /help           Show all commands
  /exit           Quit
`);
    process.exit(0);
  }

  // Handle --version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`slashbot ${VERSION}`);
    process.exit(0);
  }

  // Handle `slashbot login` directly from CLI
  if (args[0] === 'login') {
    const configManager = createConfigManager();
    await configManager.load();

    const apiKey = args[1];
    if (apiKey) {
      await configManager.saveApiKey(apiKey);
      console.log(c.success('API key saved!'));
      console.log(c.muted('Run slashbot to start.'));
    } else {
      console.log(c.violet('Slashbot Login\n'));
      console.log(c.muted('Usage: slashbot login <api_key>'));
      console.log(c.muted('Or run slashbot and use /login\n'));
      console.log(c.muted('Get your key at https://console.x.ai/'));
    }
    process.exit(0);
  }

  // Check for minimum requirements
  if (typeof Bun === 'undefined') {
    console.error(errorBlock('Slashbot requires Bun runtime'));
    console.error(c.muted('Install Bun: curl -fsSL https://bun.sh/install | bash'));
    process.exit(1);
  }

  // Start Slashbot
  const bot = new Slashbot();
  currentBot = bot;
  await bot.start();
}

// Run
main().catch((error) => {
  console.error(errorBlock(error.message));
  process.exit(1);
});
