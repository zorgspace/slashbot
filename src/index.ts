#!/usr/bin/env bun
/**
 * Slashbot - Lightweight CLI Assistant powered by Grok
 * A Claude Code-inspired terminal assistant using X.AI's Grok API.
 */

import {
  banner,
  inputPrompt,
  inputClose,
  responseStart,
  c,
  errorBlock,
  colors,
  connectorMessage,
  connectorResponse,
} from './ui/colors';

// Handle update commands before anything else
if (process.argv[2] === 'update-check' || process.argv.includes('--check-update')) {
  const { checkForUpdate } = await import('./updater');
  await checkForUpdate(false, false);
  process.exit(0);
}

if (process.argv.includes('--update') || process.argv.includes('-u')) {
  const { updateAndRestart } = await import('./updater');
  await updateAndRestart();
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
process.on('uncaughtException', err => {
  console.log(c.error(`\nError: ${err.message}`));
  // Don't exit - keep running
});

// Prevent unhandled promise rejections from crashing
process.on('unhandledRejection', reason => {
  console.log(c.error(`\nError: ${reason}`));
  // Don't exit - keep running
});

// Read version from package.json
import pkg from '../package.json';
const VERSION = pkg.version;

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
import { createSkillManager, SkillManager } from './skills/manager';
import { getLocalSlashbotDir, getLocalHistoryFile } from './constants';

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
  private skillManager: SkillManager;
  private connectors: Map<
    string,
    {
      connector: any;
      isRunning: () => boolean;
      sendMessage: (msg: string) => Promise<void>;
      stop?: () => void;
    }
  > = new Map();
  private running = false;
  private history: string[] = [];
  private historyIndex = -1;
  private loadedContextFile: string | null = null;
  private currentSource: ConnectorSource = 'cli';
  private historySaveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SlashbotConfig = {}) {
    this.fileSystem = createFileSystem(config.basePath);
    this.scheduler = createScheduler();
    this.configManager = createConfigManager();
    this.codeEditor = createCodeEditor(config.basePath);
    this.commandPermissions = createCommandPermissions();
    this.skillManager = createSkillManager(config.basePath);
  }

  private getContext(): CommandContext {
    return {
      grokClient: this.grokClient,
      scheduler: this.scheduler,
      fileSystem: this.fileSystem,
      configManager: this.configManager,
      codeEditor: this.codeEditor,
      skillManager: this.skillManager,
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

        if (!contextLoaded && (await this.codeEditor.isAuthorized())) {
          // Fallback: inject basic project context if authorized but no SLASHBOT.md
          const files = await this.codeEditor.listFiles();
          const context = `Directory: ${workDir}\nFiles:\n${files.slice(0, 50).join('\n')}`;
          this.grokClient.setProjectContext(context, workDir);
        }

        // Add available skills to system prompt
        const skillsPrompt = await this.skillManager.getSkillsForSystemPrompt();
        if (skillsPrompt) {
          const currentContext = (this.grokClient.getHistory()[0]?.content as string) || '';
          this.grokClient.setProjectContext(currentContext + skillsPrompt, workDir);
        }

        // Wire up action handlers
        this.grokClient.setActionHandlers({
          onSchedule: async (cron, commandOrPrompt, name, options) => {
            await this.scheduler.addTask(name, cron, commandOrPrompt, {
              isPrompt: options?.isPrompt,
            });
          },

          onFile: async (path, content) => {
            return await this.fileSystem.writeFile(path, content);
          },

          // Code editing handlers
          onGrep: async (pattern, options) => {
            const results = await this.codeEditor.grep(pattern, options?.glob, options);
            if (results.length === 0) {
              return 'No results';
            }
            return results.map(r => `${r.file}:${r.line}: ${r.content}`).join('\n');
          },

          onRead: async path => {
            return await this.codeEditor.readFile(path);
          },

          onEdit: async (path, search, replace) => {
            return await this.codeEditor.editFile({ path, search, replace });
          },

          onCreate: async (path, content) => {
            return await this.codeEditor.createFile(path, content);
          },

          onBash: async (command, options) => {
            const workDir = this.codeEditor.getWorkDir();

            // Security check via scheduler (blocks dangerous patterns)
            const security = this.scheduler.validateCommand(command);
            if (security.blocked) {
              console.log(c.error(`[SECURITY] Command blocked: ${security.blockedReason}`));
              return `Command blocked: ${security.blockedReason}`;
            }
            if (security.warnings.length > 0) {
              security.warnings.forEach(w => console.log(c.warning(`[SECURITY] ${w}`)));
            }

            // Background execution
            if (options?.runInBackground) {
              const { processManager } = await import('./utils/processManager');
              const managed = processManager.spawn(command, workDir);

              // Wait a moment to capture initial output
              await new Promise(resolve => setTimeout(resolve, 1500));
              const output = processManager.getOutput(managed.id, 10);

              // Return process info with initial output for LLM to analyze
              let result = `Background process started:\n- ID: ${managed.id}\n- PID: ${managed.pid}\n- Command: ${command}`;
              if (output.length > 0) {
                result += `\n- Initial output:\n${output.join('\n')}`;
              }
              result += `\n\nUser can run /ps to list processes, /kill ${managed.id} to stop.`;
              return result;
            }

            // Check if command needs interactive input (sudo, ssh, etc.)
            const needsInteractive = /^sudo\s|^ssh\s|passwd|read\s+-/.test(command);

            if (needsInteractive) {
              // Use spawn with inherited stdio for interactive commands
              const { spawn } = await import('child_process');
              return new Promise<string>(resolve => {
                const child = spawn('bash', ['-lc', command], {
                  cwd: workDir,
                  stdio: 'inherit', // Pass through stdin/stdout/stderr
                  env: { ...process.env, BASH_SILENCE_DEPRECATION_WARNING: '1' },
                });
                child.on('close', code => {
                  resolve(code === 0 ? 'Command completed' : `Command exited with code ${code}`);
                });
                child.on('error', err => {
                  resolve(`Error: ${err.message}`);
                });
              });
            }

            // Normal execution - use login shell to load user's bashrc/zshrc (nvm, pyenv, etc.)
            try {
              const { spawn } = await import('child_process');
              const timeout = options?.timeout || 30000;

              return new Promise<string>(resolve => {
                let stdout = '';
                let stderr = '';
                let killed = false;

                // Use spawn with shell:true to properly handle all bash syntax including heredocs
                const child = spawn(command, {
                  shell: '/bin/bash',
                  cwd: workDir,
                  env: { ...process.env, BASH_SILENCE_DEPRECATION_WARNING: '1' },
                });

                const timer = setTimeout(() => {
                  killed = true;
                  child.kill('SIGTERM');
                }, timeout);

                child.stdout?.on('data', data => {
                  stdout += data.toString();
                  // Limit output to prevent memory issues
                  if (stdout.length > 1024 * 1024) {
                    stdout = stdout.slice(0, 1024 * 1024) + '\n... (output truncated)';
                    child.kill('SIGTERM');
                  }
                });

                child.stderr?.on('data', data => {
                  stderr += data.toString();
                });

                child.on('close', code => {
                  clearTimeout(timer);
                  if (killed) {
                    resolve(`Error: Command timed out after ${timeout}ms`);
                  } else if (code !== 0) {
                    resolve(`Error: Command failed: ${command}\n${stderr || stdout}`);
                  } else {
                    resolve(stdout || stderr || 'Command executed');
                  }
                });

                child.on('error', err => {
                  clearTimeout(timer);
                  resolve(`Error: ${err.message}`);
                });
              });
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

          // Glob pattern matching
          onGlob: async (pattern, basePath) => {
            const workDir = this.codeEditor.getWorkDir();
            const searchDir = basePath ? `${workDir}/${basePath}` : workDir;

            try {
              const { Glob } = await import('bun');
              const glob = new Glob(pattern);
              const files: string[] = [];

              for await (const file of glob.scan({
                cwd: searchDir,
                onlyFiles: true,
                dot: false, // Exclude hidden files
              })) {
                // Exclude common non-code directories
                if (
                  !file.includes('node_modules/') &&
                  !file.includes('.git/') &&
                  !file.includes('dist/')
                ) {
                  files.push(basePath ? `${basePath}/${file}` : file);
                }
                // Limit results
                if (files.length >= 100) break;
              }

              return files;
            } catch {
              return [];
            }
          },

          // List directory contents
          onLS: async (path, ignore) => {
            const workDir = this.codeEditor.getWorkDir();
            const targetPath = path.startsWith('/') ? path : `${workDir}/${path}`;
            const ignoreSet = new Set(ignore || ['node_modules', '.git', 'dist']);

            try {
              const fs = await import('fs/promises');
              const entries = await fs.readdir(targetPath, { withFileTypes: true });
              const results: string[] = [];

              for (const entry of entries) {
                if (ignoreSet.has(entry.name)) continue;
                const type = entry.isDirectory() ? '/' : '';
                results.push(`${entry.name}${type}`);
              }

              return results.sort();
            } catch (error: any) {
              return [`Error: ${error.message}`];
            }
          },

          // Git operations
          onGit: async (command, args) => {
            const workDir = this.codeEditor.getWorkDir();
            const allowedCommands = [
              'status',
              'diff',
              'log',
              'branch',
              'add',
              'commit',
              'checkout',
              'stash',
            ];

            if (!allowedCommands.includes(command)) {
              return `Error: Git command '${command}' not allowed`;
            }

            // Build the git command
            let gitCmd = `git ${command}`;
            if (args) {
              gitCmd += ` ${args}`;
            }

            // Add safety limits for log
            if (command === 'log' && !args?.includes('-n') && !args?.includes('--oneline')) {
              gitCmd += ' -n 20';
            }

            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              const { stdout, stderr } = await execAsync(gitCmd, {
                cwd: workDir,
                timeout: 30000,
              });
              return stdout || stderr || 'OK';
            } catch (error: any) {
              return `Error: ${error.message || error}`;
            }
          },

          // Format code
          onFormat: async path => {
            const workDir = this.codeEditor.getWorkDir();
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              const target = path || '.';
              const { stdout, stderr } = await execAsync(`npx prettier --write "${target}"`, {
                cwd: workDir,
                timeout: 30000,
              });
              return stdout || stderr || 'Formatted';
            } catch (error: any) {
              return `Error: ${error.message || error}`;
            }
          },

          // TypeScript type check
          onTypecheck: async () => {
            const workDir = this.codeEditor.getWorkDir();
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
                cwd: workDir,
                timeout: 60000,
              });
              return stdout || stderr || 'No errors';
            } catch (error: any) {
              // tsc exits with error code on type errors, but we want the output
              return error.stdout || error.stderr || error.message || 'Typecheck failed';
            }
          },

          // Fetch URL and return content for context
          onFetch: async (url, prompt) => {
            try {
              // Fetch the URL with timeout
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

              const response = await fetch(url, {
                headers: {
                  'User-Agent': 'Slashbot/1.0 (CLI Assistant)',
                  Accept: 'text/html,application/json,text/plain,*/*',
                },
                redirect: 'follow',
                signal: controller.signal,
              });

              clearTimeout(timeout);

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              const contentType = response.headers.get('content-type') || '';
              let content: string;

              if (contentType.includes('application/json')) {
                const json = await response.json();
                content = JSON.stringify(json, null, 2);
              } else {
                content = await response.text();

                // If HTML, extract text content
                if (contentType.includes('text/html')) {
                  // Simple HTML to text - remove tags, decode entities
                  content = content
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ')
                    .trim();
                }
              }

              // Truncate large content to avoid overwhelming context
              const MAX_FETCH_CHARS = 15000; // ~3750 tokens
              let truncated = false;
              if (content.length > MAX_FETCH_CHARS) {
                content = content.slice(0, MAX_FETCH_CHARS);
                truncated = true;
              }

              // Return content with prompt hint - agentic loop will process it
              const truncationNote = truncated
                ? `\n\n[Content truncated to ${MAX_FETCH_CHARS} chars]`
                : '';
              if (prompt) {
                return `[Fetched from ${url}]\n\n${content}${truncationNote}\n\n[User wants: ${prompt}]`;
              }

              return `[Fetched from ${url}]\n\n${content}${truncationNote}`;
            } catch (error: any) {
              throw new Error(`Fetch failed: ${error.message || error}`);
            }
          },

          // Web search using X.AI search API
          onSearch: async (query, options) => {
            if (!this.grokClient) {
              throw new Error('Not connected to Grok');
            }
            return await this.grokClient.searchChat(query, {
              enableXSearch: true,
            });
          },

          // Skill invocation
          onSkill: async (name, args) => {
            const skill = await this.skillManager.getSkill(name);
            if (!skill) {
              throw new Error(`Skill not found: ${name}`);
            }
            let content = `[SKILL: ${name}]\n${skill.content}`;
            if (args) {
              content += `\n\n[TASK: ${args}]`;
            }
            return content;
          },

          // Skill installation
          onSkillInstall: async (url, name) => {
            const skill = await this.skillManager.installSkill(url, name);
            // Reinitialize Grok to update system prompt with new skill
            await this.initializeGrok();
            return { name: skill.name, path: skill.path };
          },

          // Connector configuration
          onTelegramConfig: async (botToken, chatId) => {
            try {
              let finalChatId = chatId;

              // Auto-detect chat_id if not provided
              if (!finalChatId) {
                const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
                const data = (await response.json()) as {
                  ok: boolean;
                  result: Array<{ message?: { chat?: { id: number } } }>;
                };

                if (!data.ok) {
                  return { success: false, message: 'Invalid bot token' };
                }

                const update = data.result?.find((u: any) => u.message?.chat?.id);
                if (update?.message?.chat?.id) {
                  finalChatId = String(update.message.chat.id);
                } else {
                  return {
                    success: false,
                    message: 'No messages found. Send a message to the bot first.',
                  };
                }
              }

              // Save configuration
              await this.configManager.saveTelegramConfig(botToken, finalChatId);
              return {
                success: true,
                message: `Telegram configured! Restart to connect.`,
                chatId: finalChatId,
              };
            } catch (error: any) {
              return { success: false, message: error.message || 'Configuration failed' };
            }
          },

          onDiscordConfig: async (botToken, channelId) => {
            try {
              await this.configManager.saveDiscordConfig(botToken, channelId);
              return { success: true, message: `Discord configured! Restart to connect.` };
            } catch (error: any) {
              return { success: false, message: error.message || 'Configuration failed' };
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

  private async handleInput(
    input: string,
    source: ConnectorSource = 'cli',
  ): Promise<string | void> {
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
      // Check for base64 data URL
      const imageMatch = trimmed.match(/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/i);
      if (imageMatch) {
        addImage(trimmed);
        console.log(`${c.success('🖼️  Image added to context #')}${imageBuffer.length}`);
        return;
      }

      // Check for image file path (supports ~, absolute and relative paths)
      const pathMatch = trimmed.match(/^['"]?([~\/]?[^\s'"]+\.(png|jpg|jpeg|gif|webp|bmp))['"]?$/i);
      if (pathMatch) {
        try {
          let filePath = pathMatch[1];
          // Expand ~ to home directory
          if (filePath.startsWith('~')) {
            filePath = filePath.replace('~', process.env.HOME || '');
          }
          // Make relative paths absolute
          if (!filePath.startsWith('/')) {
            filePath = `${process.cwd()}/${filePath}`;
          }

          const fs = await import('fs');
          if (fs.existsSync(filePath)) {
            const imageData = fs.readFileSync(filePath);
            const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
            const mimeTypes: Record<string, string> = {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              gif: 'image/gif',
              webp: 'image/webp',
              bmp: 'image/bmp',
            };
            const mimeType = mimeTypes[ext] || 'image/png';
            const base64 = imageData.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64}`;
            addImage(dataUrl);
            console.log(
              `${c.success('🖼️  Image loaded: ')}${filePath.split('/').pop()} (${Math.round(base64.length / 1024)}KB)`,
            );
            console.log(c.muted('   Now ask a question about the image'));
            return;
          }
        } catch (err) {
          // Not a valid image file, continue processing as normal input
        }
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
        const response = await this.grokClient.chatWithResponse(
          trimmed,
          source as 'telegram' | 'discord',
        );
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
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);
      if (await file.exists()) {
        const content = await file.text();
        this.history = content.split('\n').filter(line => line.trim());
      }
    } catch {
      // No history file yet
    }
  }

  private saveHistory(): void {
    // Debounce: only save after 2 seconds of no new inputs
    if (this.historySaveTimeout) {
      clearTimeout(this.historySaveTimeout);
    }
    this.historySaveTimeout = setTimeout(async () => {
      try {
        const { mkdir } = await import('fs/promises');
        const configDir = getLocalSlashbotDir();
        await mkdir(configDir, { recursive: true });

        // Keep last 500 commands
        const historyToSave = this.history.slice(-500);
        await Bun.write(getLocalHistoryFile(), historyToSave.join('\n'));
      } catch {
        // Ignore save errors
      }
    }, 2000);
  }

  async start(): Promise<void> {
    // Load configuration
    await this.configManager.load();

    // Initialize scheduler (load persisted tasks)
    await this.scheduler.init();

    // Initialize code editor
    await this.codeEditor.init();

    // Initialize skill manager
    await this.skillManager.init();

    // Initialize command permissions
    await this.commandPermissions.load();

    // Load command history
    await this.loadHistory();

    // Initialize Grok client if API key available
    await this.initializeGrok();

    // Check for updates in background (non-blocking, once per 24h)
    import('./updater').then(({ startupUpdateCheck }) => startupUpdateCheck()).catch(() => {});

    // Set up LLM handler for scheduled tasks (allows tasks to use AI capabilities)
    this.scheduler.setLLMHandler(async (prompt: string) => {
      if (!this.grokClient) {
        throw new Error('Grok client not initialized');
      }
      return await this.grokClient.chat(prompt);
    });

    // Initialize transcription service if OpenAI API key available
    const openaiKey = this.configManager.getOpenAIApiKey();
    let voiceEnabled = false;
    if (openaiKey) {
      initTranscription(openaiKey);
      voiceEnabled = true;
    }

    // Start scheduler
    this.scheduler.start();

    // Initialize Telegram connector if configured
    const telegramConfig = this.configManager.getTelegramConfig();
    if (telegramConfig) {
      try {
        const connector = createTelegramConnector(telegramConfig);
        connector.setMessageHandler(async (message, source) => {
          // Display incoming message
          process.stderr.write(connectorMessage('telegram', message) + '\n');
          const response = await this.handleInput(message, source);
          // Display response sent
          if (response) {
            process.stderr.write(connectorResponse('telegram', response) + '\n');
          }
          // Redraw prompt after Telegram processing completes
          if (this.running) {
            process.stdout.write(inputPrompt());
          }
          return response as string;
        });
        await connector.start();
        this.connectors.set('telegram', {
          connector,
          isRunning: () => connector.isRunning(),
          sendMessage: msg => connector.sendMessage(msg),
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
          // Display incoming message
          process.stderr.write(connectorMessage('discord', message) + '\n');
          const response = await this.handleInput(message, source);
          // Display response sent
          if (response) {
            process.stderr.write(connectorResponse('discord', response) + '\n');
          }
          // Redraw prompt after Discord processing completes
          if (this.running) {
            process.stdout.write(inputPrompt());
          }
          return response as string;
        });
        await connector.start();
        this.connectors.set('discord', {
          connector,
          isRunning: () => connector.isRunning(),
          sendMessage: msg => connector.sendMessage(msg),
          stop: () => connector.stop(),
        });
      } catch (error) {
        console.log(c.warning(`[Discord] Could not start: ${error}`));
      }
    }

    // Display banner with all info
    const tasks = this.scheduler.listTasks();
    console.log(
      banner({
        version: VERSION,
        workingDir: this.codeEditor.getWorkDir(),
        contextFile: this.loadedContextFile,
        tasksCount: tasks.length,
        telegram: this.connectors.has('telegram'),
        discord: this.connectors.has('discord'),
        voice: voiceEnabled,
      }),
    );

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
            this.saveHistory();
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

    // Kill all background processes
    try {
      const { processManager } = await import('./utils/processManager');
      const killed = processManager.killAll();
      if (killed > 0) {
        console.log(c.muted(`[Process] Killed ${killed} background process(es)`));
      }
    } catch {
      // Ignore
    }

    // Stop all connectors
    for (const [, conn] of this.connectors) {
      conn.stop?.();
    }
    // Flush history immediately on stop
    if (this.historySaveTimeout) {
      clearTimeout(this.historySaveTimeout);
    }
    try {
      const { mkdir } = await import('fs/promises');
      const configDir = getLocalSlashbotDir();
      await mkdir(configDir, { recursive: true });
      const historyToSave = this.history.slice(-500);
      await Bun.write(getLocalHistoryFile(), historyToSave.join('\n'));
    } catch {
      // Ignore save errors
    }
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
main().catch(error => {
  console.error(errorBlock(error.message));
  process.exit(1);
});
