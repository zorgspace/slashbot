#!/usr/bin/env bun
/**
 * Slashbot - Lightweight CLI Assistant powered by Grok
 * A Claude Code-inspired terminal assistant using X.AI's Grok API.
 */

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
    // Abort current operation - the normal flow will handle showing the prompt
    currentBot?.abortCurrentOperation();
    // Just clear the current line (animation), let normal error handling show prompt
    process.stdout.write('\r\x1b[K');
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

  // First Ctrl+C - show warning and redraw prompt
  console.log(c.warning('\nPress Ctrl+C again to exit'));
  process.stdout.write(inputPrompt());
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
import { createTelegramConnector, TelegramConnector } from './connectors/telegram';
import { createDiscordConnector, DiscordConnector } from './connectors/discord';
import type { ConnectorSource } from './connectors/base';
import { initTranscription } from './services/transcription';
import { enableBracketedPaste, disableBracketedPaste, expandPaste } from './ui/pasteHandler';
import { readMultilineInput } from './ui/multilineInput';



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
  private connectors: Map<string, { connector: any; isRunning: () => boolean; sendMessage: (msg: string) => Promise<void>; stop?: () => void }> = new Map();
  private running = false;
  private history: string[] = [];
  private historyIndex = -1;
  private loadedContextFile: string | null = null;
  private currentSource: ConnectorSource = 'cli';

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
      connectors: this.connectors,
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

        // Load skills from .slashbot/skills/
        try {
          const skillsDir = `${workDir}/.slashbot/skills`;
          const { readdir } = await import('fs/promises');
          const files = await readdir(skillsDir);
          const skills = files
            .filter(f => f.endsWith('.md'))
            .map(f => `.slashbot/skills/${f}`); // Include full path to preserve case
          if (skills.length > 0) {
            this.grokClient.setSkills(skills);
          }
        } catch {
          // Skills directory doesn't exist or is empty
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

          onNotify: async (message, target) => {
            const sent: string[] = [];
            const failed: string[] = [];

            for (const [name, conn] of this.connectors) {
              // Skip if target specified and doesn't match
              if (target && name !== target) continue;
              // Skip if not running
              if (!conn.isRunning()) continue;

              try {
                await conn.sendMessage(message);
                sent.push(name);
              } catch {
                failed.push(name);
              }
            }

            return { sent, failed };
          },

          onWebSearch: async (query) => {
            const { searchWeb, formatResults } = await import('./services/websearch');
            const results = await searchWeb(query);
            return formatResults(results);
          },

          onFetch: async (url) => {
            const { fetchPage } = await import('./services/websearch');
            return await fetchPage(url);
          },
        });
      } catch {
        this.grokClient = null;
      }
    } else {
      this.grokClient = null;
    }
  }

  private async handleInput(input: string, source: ConnectorSource = 'cli'): Promise<string | void> {
    // Expand any paste placeholders back to original content (CLI only)
    const expanded = source === 'cli' ? expandPaste(input) : input;
    const trimmed = expanded.trim();

    if (!trimmed) return;

    // Handle ? shortcut for help
    if (trimmed === '?') {
      const parsed = await parseInput('/help');
      await executeCommand(parsed, this.getContext());
      return;
    }

    // Handle pasted images directly into buffer (CLI only)
    if (source === 'cli') {
      const imageMatch = trimmed.match(/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/i);
      if (imageMatch) {
        addImage(trimmed);
        console.log(`${c.success('🖼️  Image pasted to buffer #')}${imageBuffer.length}`);
        return;
      }
    }

    const parsed = await parseInput(trimmed);

    // Handle slash commands
    if (parsed.isCommand) {
      await executeCommand(parsed, this.getContext());
      return;
    }

    // Handle natural language - send to Grok
    if (!this.grokClient) {
      const msg = 'Not connected to Grok. Use /login to enter your API key.';
      if (source !== 'cli') return msg;
      console.log(c.warning('Not connected to Grok'));
      console.log(c.muted('  Use /login to enter your API key'));
      console.log(inputClose());
      return;
    }

    try {
      // For external connectors (Telegram, Discord), collect the response
      if (source !== 'cli') {
        const response = await this.grokClient.chatWithResponse(trimmed, source as 'telegram' | 'discord');
        return response;
      }

      // For CLI, stream to console
      await this.grokClient.chat(trimmed);
      console.log(inputClose());
    } catch (error) {
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        if (source === 'cli') console.log(inputClose());
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (source !== 'cli') return `Error: ${errorMsg}`;
      console.log(errorBlock(errorMsg));
      console.log(inputClose());
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const historyPath = `${process.cwd()}/.slashbot/history`;
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
      const configDir = `${process.cwd()}/.slashbot`;
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

    // Initialize transcription service if OpenAI API key available
    const openaiKey = this.configManager.getOpenAIApiKey();
    if (openaiKey) {
      initTranscription(openaiKey);
      console.log(c.muted('[Voice] Transcription enabled (Whisper)'));
    }

    // Start scheduler
    this.scheduler.start();

    // Initialize Telegram connector if configured
    const telegramConfig = this.configManager.getTelegramConfig();
    if (telegramConfig) {
      try {
        const connector = createTelegramConnector(telegramConfig);
        connector.setMessageHandler(async (message, source) => {
          console.log(c.muted(`\n[Telegram] ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`));
          const response = await this.handleInput(message, source);
          return response as string;
        });
        await connector.start();
        this.connectors.set('telegram', {
          connector,
          isRunning: () => connector.isRunning(),
          sendMessage: (msg) => connector.sendMessage(msg),
          stop: () => connector.stop(),
        });
      } catch (error) {
        console.log(c.warning(`[Telegram] Could not start: ${error}`));
      }
    }

    // Initialize Discord connector if configured
    const discordConfig = this.configManager.getDiscordConfig();
    if (discordConfig) {
      try {
        const connector = createDiscordConnector(discordConfig);
        connector.setMessageHandler(async (message, source) => {
          console.log(c.muted(`\n[Discord] ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`));
          const response = await this.handleInput(message, source);
          return response as string;
        });
        await connector.start();
        this.connectors.set('discord', {
          connector,
          isRunning: () => connector.isRunning(),
          sendMessage: (msg) => connector.sendMessage(msg),
          stop: () => connector.stop(),
        });
      } catch (error) {
        console.log(c.warning(`[Discord] Could not start: ${error}`));
      }
    }

    // Display banner with all info
    const tasks = this.scheduler.listTasks();
    console.log(banner({
      version: VERSION,
      workingDir: this.codeEditor.getWorkDir(),
      contextFile: this.loadedContextFile,
      tasksCount: tasks.length,
    }));

    // Enable bracketed paste mode to detect pastes
    enableBracketedPaste();

    // Set scheduler callback to redraw prompt after task execution
    this.scheduler.setOnTaskComplete(() => {
      if (this.running) {
        process.stdout.write(inputPrompt());
      }
    });

    this.running = true;

    // Handle line input with multi-line support (Shift+Enter for new lines)
    const askQuestion = async (): Promise<void> => {
      while (this.running) {
        try {
          const answer = await readMultilineInput({
            prompt: inputPrompt(),
            history: this.history,
          });

          // Skip empty input
          if (!answer.trim()) {
            continue;
          }

          // Add to history if not duplicate of last
          if (answer.trim() !== this.history[this.history.length - 1]) {
            this.history.push(answer.trim());
            await this.saveHistory();
          }

          await this.handleInput(answer);
        } catch {
          // Input was interrupted, continue loop
        }
      }
    };

    // Start the REPL
    askQuestion();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.scheduler.stop();
    // Stop all connectors
    for (const [, conn] of this.connectors) {
      conn.stop?.();
    }
    await this.saveHistory();
    // Disable bracketed paste mode
    disableBracketedPaste();
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
