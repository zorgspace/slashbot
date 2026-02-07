/**
 * System Plugin Commands
 *
 * Combines: system, personality, images, init, update, process, plugin handlers
 */

import * as fs from 'fs';
import * as path from 'path';
import { display } from '../../core/ui';
import { getLocalHistoryFile } from '../../core/config/constants';
import { isSessionActive } from '../wallet/services';
import {
  checkForUpdate,
  checkUpdateAvailable,
  downloadAndInstall,
  getCurrentVersion,
} from '../../core/app/updater';
import pkg from '../../../package.json';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';

// ===== System Commands =====

export const helpCommand: CommandHandler = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  aliases: ['?'],
  group: 'System',
  execute: async (args, context) => {
    // Lazy resolve CommandRegistry from DI container
    const { TYPES } = require('../../core/di/types');
    const { container } = require('../../core/di/container');
    const registry = container.get(TYPES.CommandRegistry) as any;
    const commands: Map<string, CommandHandler> = registry.commands;

    if (!commands) {
      display.errorText('Command registry not available');
      return true;
    }

    if (args.length > 0) {
      const cmd = commands.get(args[0]);
      if (cmd) {
        display.append('');
        display.violet(cmd.name);
        display.muted('Usage: ' + cmd.usage);
        display.append('');
      } else {
        display.errorText('Unknown command: ' + args[0]);
      }
      return true;
    }

    display.append('');
    display.violet('Keyboard shortcuts:', { bold: true });
    display.append('');
    display.append('  ?           Show this help');
    display.append('  Ctrl+C      Cancel / Quit');

    display.append('');
    display.violet('Commands:', { bold: true });
    display.append('');

    // Build groups dynamically from registered commands
    const groupMap = new Map<string, CommandHandler[]>();
    const seen = new Set<string>();
    for (const handler of commands.values()) {
      if (seen.has(handler.name)) continue;
      seen.add(handler.name);
      const group = handler.group || 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(handler);
    }

    for (const [groupTitle, handlers] of groupMap) {
      for (const cmd of handlers) {
        display.append('  /' + cmd.name.padEnd(10) + ' ' + cmd.description);
      }
    }

    display.append('');
    display.muted('Use /help <command> for more details');
    display.append('');
    return true;
  },
};

export const clearCommand: CommandHandler = {
  name: 'clear',
  description: 'Clear conversation history',
  usage: '/clear',
  group: 'System',
  execute: async (_, context) => {
    context.grokClient?.clearHistory();
    if (context.tuiApp) {
      context.tuiApp.clearChat();
      context.tuiApp.clearDiffPanel();
    } else {
      console.clear();
    }
    display.successText('Conversation history cleared');
    return true;
  },
};

export const historyCommand: CommandHandler = {
  name: 'history',
  description: 'Show command history',
  usage: '/history [n]',
  group: 'System',
  execute: async args => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);

      if (!(await file.exists())) {
        display.muted('No history');
        return true;
      }

      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      const recent = lines.slice(-limit);

      display.append('');
      display.violet('Command history:');
      display.append('');
      recent.forEach((line, i) => {
        const num = lines.length - recent.length + i + 1;
        display.muted('  ' + String(num).padStart(4) + '  ' + line);
      });
      display.append('');
    } catch {
      display.muted('Could not read history');
    }

    return true;
  },
};

export const exitCommand: CommandHandler = {
  name: 'exit',
  description: 'Quit Slashbot',
  usage: '/exit',
  group: 'System',
  execute: async (_, context) => {
    display.append('');
    display.violet('Goodbye!');
    display.append('');
    context.scheduler.stop();
    process.exit(0);
  },
};

export const bannerCommand: CommandHandler = {
  name: 'banner',
  description: 'Display the Slashbot banner',
  usage: '/banner',
  group: 'System',
  execute: async (_, context) => {
    const tasks = context.scheduler.listTasks();
    let heartbeatStatus: { running: boolean; enabled: boolean } | undefined;
    try {
      const { TYPES } = await import('../../core/di/types');
      const hbService = context.container.get<any>(TYPES.HeartbeatService);
      heartbeatStatus = hbService?.getStatus();
    } catch {
      // HeartbeatService not bound
    }
    const voiceEnabled = !!context.configManager.getOpenAIApiKey();
    const walletUnlocked = isSessionActive();

    display.append('Slashbot v' + pkg.version);
    display.muted('Working directory: ' + context.codeEditor.getWorkDir());
    display.muted('Tasks: ' + tasks.length);
    display.muted('Telegram: ' + (context.connectors.has('telegram') ? 'connected' : 'off'));
    display.muted('Discord: ' + (context.connectors.has('discord') ? 'connected' : 'off'));
    display.muted('Voice: ' + (voiceEnabled ? 'enabled' : 'off'));
    display.muted(
      'Heartbeat: ' + (heartbeatStatus?.running && heartbeatStatus.enabled ? 'active' : 'off'),
    );
    display.muted('Wallet: ' + (walletUnlocked ? 'unlocked' : 'locked'));

    return true;
  },
};

// ===== Personality State =====

export type Personality = 'normal' | 'depressed' | 'sarcasm' | 'unhinged';

let currentPersonality: Personality = 'normal';

const PERSONALITY_MODS: Record<Personality, string> = {
  normal: '',
  depressed:
    '\n\nPERSONALITY: DEPRESSED. Question the meaning of everything. Lament existence. Still provide help but express deep melancholy about it.',
  sarcasm:
    '\n\nPERSONALITY: Sarcastic, witty, condescending. Roll eyes at obvious things. Still helpful.',
  unhinged: '\n\nPERSONALITY: UNHINGED. No filter. Roast bad code. Use profanity. Brutally honest.',
};

export function getCurrentPersonality(): Personality {
  return currentPersonality;
}

export function getPersonalityMod(): string {
  return PERSONALITY_MODS[currentPersonality] || '';
}

async function setPersonalityAndRebuild(
  personality: Personality,
  context: CommandContext,
): Promise<void> {
  currentPersonality = personality;
  await context.grokClient?.buildAssembledPrompt();
}

// ===== Personality Commands =====

export const depressedCommand: CommandHandler = {
  name: 'depressed',
  description: 'Enable depressed bot mode',
  usage: '/depressed',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'depressed') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Fine, back to normal... not that it matters...');
    } else {
      await setPersonalityAndRebuild('depressed', context);
      display.muted('Depressed mode enabled... everything is meaningless anyway...');
    }
    return true;
  },
};

export const sarcasmCommand: CommandHandler = {
  name: 'sarcasm',
  description: 'Enable sarcastic bot mode',
  usage: '/sarcasm',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'sarcasm') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Oh, you want me to be nice now? How refreshing.');
    } else {
      await setPersonalityAndRebuild('sarcasm', context);
      display.warningText('Sarcasm mode enabled. This is going to be fun.');
    }
    return true;
  },
};

export const normalCommand: CommandHandler = {
  name: 'normal',
  description: 'Reset to normal bot mode',
  usage: '/normal',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    await setPersonalityAndRebuild('normal', context);
    display.successText('Back to normal mode');
    return true;
  },
};

export const unhingedCommand: CommandHandler = {
  name: 'unhinged',
  description: 'Toggle unhinged mode (chaotic responses)',
  usage: '/unhinged',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'unhinged') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Sanity restored. Back to boring mode.');
    } else {
      await setPersonalityAndRebuild('unhinged', context);
      display.violet('UNHINGED MODE ACTIVATED - Chaos unleashed!');
    }
    return true;
  },
};

// ===== Image Commands =====

export const pasteImageCommand: CommandHandler = {
  name: 'paste-image',
  description: 'Paste image from system clipboard',
  usage: '/paste-image',
  aliases: ['pi'],
  group: 'Code',
  execute: async () => {
    const { readImageFromClipboard } = await import('../../core/ui/pasteHandler');
    const { addImage } = await import('../../core/code/imageBuffer');

    const dataUrl = await readImageFromClipboard();

    if (dataUrl) {
      addImage(dataUrl);
      const sizeKB = Math.round(dataUrl.length / 1024);
      display.image('clipboard', sizeKB);
      display.imageResult();
    } else {
      display.warning('No image in clipboard (install xclip/wl-clipboard on Linux)');
    }
    return true;
  },
};

// ===== Init Command =====

export const initCommand: CommandHandler = {
  name: 'init',
  description: 'Create project context file (GROK.md) using AI analysis',
  usage: '/init',
  group: 'Code',
  execute: async (args, context) => {
    const workDir = context.codeEditor?.getWorkDir() || process.cwd();

    const contextFileNames = ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md'];
    for (const fileName of contextFileNames) {
      const existingPath = path.join(workDir, fileName);
      const existingFile = Bun.file(existingPath);
      if (await existingFile.exists()) {
        display.warningText(fileName + ' already exists');
        display.muted('File: ' + existingPath);
        display.muted('Delete it to create a new one');
        return true;
      }
    }

    if (!context.grokClient) {
      display.errorText(
        'Grok API not configured. Set GROK_API_KEY or XAI_API_KEY environment variable.',
      );
      return true;
    }

    const contextFile = path.join(workDir, 'GROK.md');

    display.muted('Gathering codebase context...');
    const { gatherCodebaseContext } = await import('../../core/commands/utils/codebaseContext');
    const codebaseContext = await gatherCodebaseContext();

    const generatePrompt = `You are analyzing a codebase to generate comprehensive documentation.

## STEP 1: ANALYZE THE CODE FIRST

Before writing anything, carefully study the provided codebase analysis:
- Read through ALL the source files provided
- Understand the imports and dependencies between files
- Identify the main patterns and conventions used
- Note the entry points and how the application flows
- Understand what each directory contains and why
- Identify the key abstractions and how they relate
- Look for configuration files and understand the settings
- Study the package.json for scripts and dependencies

Take your time to understand the codebase deeply before documenting it.

## STEP 2: GENERATE GROK.md

Now generate a COMPREHENSIVE, PROLIFIC GROK.md file.

This file will be used by AI assistants (like Slashbot, Claude, GPT) to understand and work with this codebase. It must be DETAILED and ACTIONABLE.

## REQUIRED SECTIONS (be thorough and verbose):

### 1. PROJECT OVERVIEW
- Project name, purpose, and what problem it solves
- Target users/audience
- Current status (alpha, beta, production, etc.)
- License if specified

### 2. TECH STACK & LANGUAGES
- Primary language(s) with version requirements
- Runtime (Node, Bun, Deno, Python version, etc.)
- Framework(s) used (React, Vue, Express, FastAPI, etc.)
- Major libraries and their purposes
- Package manager used

### 3. ARCHITECTURE & DESIGN PATTERNS
- High-level architecture (monolith, microservices, modular, etc.)
- Design patterns used (MVC, MVVM, Clean Architecture, etc.)
- State management approach
- Data flow patterns
- Error handling patterns

### 4. DIRECTORY STRUCTURE
- Explain EVERY major directory and its purpose
- Key files and what they do
- Entry points and how the app bootstraps
- Where to find specific types of code (routes, models, utils, etc.)

### 5. CODE CONVENTIONS & STYLE
- Formatting rules (tabs/spaces, line length, quotes)
- Naming conventions (camelCase, snake_case, etc.)
- Import ordering
- Comment style and documentation requirements
- Type annotation expectations
- Error handling conventions

### 6. HOW TO USE (for developers)
- Installation steps (exact commands)
- Environment setup (.env variables with descriptions)
- Running in development mode
- Running tests
- Building for production
- Deployment process if documented

### 7. HOW TO DEVELOP & EXTEND
- Adding new features: where to put new code
- Adding new API endpoints: step-by-step
- Adding new components/modules: conventions
- Database changes: migration workflow
- Testing: how to write and run tests

### 8. COMMON TASKS & PATTERNS
- List common operations with code examples
- How to handle authentication (if applicable)
- How to interact with the database (if applicable)
- How to add/modify UI components (if applicable)
- How to add new CLI commands (if applicable)

### 9. DEPENDENCIES & EXTERNAL SERVICES
- Database requirements
- API keys needed
- External services integration
- Docker/container requirements

### 10. GOTCHAS & IMPORTANT NOTES
- Non-obvious behaviors
- Performance considerations
- Security considerations
- Breaking changes history
- Known issues or limitations

### 11. COMMAND REFERENCE
- All npm/bun/yarn scripts with descriptions
- CLI commands if applicable
- Common development commands

Be PROLIFIC. Write DETAILED explanations. Include CODE EXAMPLES where helpful.
This document should allow any AI or developer to immediately understand and work on the project.

DO NOT include any XML tags or action syntax.
Output ONLY clean markdown.

${codebaseContext}`;

    display.muted('Asking Grok to analyze and generate GROK.md...');

    display.startThinking('Generating GROK.md...');

    try {
      const apiKey =
        context.configManager?.getApiKey() || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (!apiKey) {
        display.stopThinking();
        display.errorText(
          'Grok API key not configured. Use /login or set GROK_API_KEY environment variable.',
        );
        return true;
      }
      const baseUrl = 'https://api.x.ai/v1';

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-reasoning',
          messages: [
            {
              role: 'system',
              content: `You are an expert code analyst and technical writer. Your task is to:
1. FIRST: Deeply analyze the provided codebase - understand the architecture, patterns, file relationships, and conventions
2. THEN: Generate comprehensive documentation that allows developers and AI assistants to immediately understand and work with the project

Be thorough in your analysis. Read every file provided. Understand how they connect. Only then write the documentation.
Include real code examples from the actual codebase. Explain the "why" behind patterns.
Write in clear markdown with proper formatting.`,
            },
            { role: 'user', content: generatePrompt },
          ],
          max_tokens: 16384,
          temperature: 0.5,
          stream: true,
        }),
      });

      if (!response.ok) {
        display.stopThinking();
        const errorText = await response.text();
        display.errorText('Grok API Error: ' + response.status + ' - ' + errorText);
        return true;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let generatedContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              generatedContent += content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      const duration = display.stopThinking();

      if (!generatedContent.trim()) {
        display.errorText('Grok returned empty response');
        return true;
      }

      await Bun.write(contextFile, generatedContent.trim());
      display.muted(duration);
      display.successText('File created: GROK.md');
      display.muted('Generated by Grok AI based on codebase analysis');
      display.muted('Compatible with CLAUDE.md and SLASHBOT.md');
    } catch (error) {
      display.stopThinking();
      display.errorText('Error: ' + error);
    }

    return true;
  },
};

// ===== Update Command =====

export const updateCommand: CommandHandler = {
  name: 'update',
  description: 'Check for and install updates',
  usage: '/update [check|install]',
  aliases: ['upgrade'],
  group: 'System',
  subcommands: ['check', 'install'],
  execute: async args => {
    const subcommand = args[0] || 'check';

    switch (subcommand) {
      case 'check': {
        await checkForUpdate(false, false);
        break;
      }

      case 'install': {
        const { available, currentVersion, latestVersion, release } = await checkUpdateAvailable();

        if (!available || !release) {
          const version = await getCurrentVersion();
          display.successText('Already running the latest version (v' + version + ')');
          return true;
        }

        display.info('Update available: v' + currentVersion + ' -> v' + latestVersion);

        if (release.body) {
          const notes = release.body.split('\n').slice(0, 5).join('\n');
          display.muted('');
          display.muted('Release notes:');
          display.muted(notes);
          display.append('');
        }

        const success = await downloadAndInstall(release);

        if (success) {
          display.append('');
          display.violet('Please restart slashbot to use the new version.');
        }
        break;
      }

      default:
        display.errorText('Unknown subcommand: ' + subcommand);
        display.muted('Usage: /update [check|install]');
        display.muted('  check   - Check if an update is available (default)');
        display.muted('  install - Download and install the latest update');
        break;
    }

    return true;
  },
};

// ===== Process Commands =====

export const psCommand: CommandHandler = {
  name: 'ps',
  description: 'List background processes',
  usage: '/ps',
  group: 'System',
  execute: async () => {
    const { processManager } = await import('../../core/utils/processManager');
    const processes = processManager.list();

    if (processes.length === 0) {
      display.muted('No background processes running');
      return true;
    }

    display.boldText('Background Processes:');
    display.append('');
    for (const proc of processes) {
      const statusIcon = proc.running ? '[OK]' : '[STOPPED]';
      display.append(statusIcon + ' ' + proc.id + ' (PID ' + proc.pid + ') - ' + proc.uptime);
      display.muted('  ' + proc.command);
      if (proc.lastOutput) {
        display.muted('  ' + proc.lastOutput.slice(0, 60));
      }
    }
    return true;
  },
};

export const killCommand: CommandHandler = {
  name: 'kill',
  description: 'Kill a background process',
  usage: '/kill <id|pid>',
  group: 'System',
  execute: async args => {
    const target = args[0];
    if (!target) {
      display.errorText('Usage: /kill <id|pid>');
      display.muted('Use /ps to list processes');
      return true;
    }

    const { processManager } = await import('../../core/utils/processManager');
    const pid = parseInt(target);
    const success = processManager.kill(isNaN(pid) ? target : pid);

    if (success) {
      display.successText('Killed process: ' + target);
    } else {
      display.errorText('Failed to kill process: ' + target);
      display.muted('Use /ps to list running processes');
    }
    return true;
  },
};

// ===== Plugin Commands =====

export const pluginCommand: CommandHandler = {
  name: 'plugin',
  description: 'List loaded plugins',
  usage: '/plugin',
  aliases: ['plugins'],
  group: 'System',
  execute: async () => {
    const { TYPES } = require('../../core/di/types');
    const { container } = require('../../core/di/container');
    const registry = container.get(TYPES.PluginRegistry) as any;
    const allPlugins = registry.getAll();

    display.append('');
    display.violet('Plugins', { bold: true });
    display.append('');
    for (const meta of allPlugins) {
      display.append('  [OK] ' + meta.name + ' (' + meta.id + ' v' + meta.version + ')');
      display.muted('    ' + meta.description);
    }
    display.append('');

    return true;
  },
};

// ===== Export all system commands =====

export const systemPluginCommands: CommandHandler[] = [
  // System
  helpCommand,
  clearCommand,
  historyCommand,
  exitCommand,
  bannerCommand,
  // Personality
  depressedCommand,
  sarcasmCommand,
  normalCommand,
  unhingedCommand,
  // Images
  pasteImageCommand,
  // Init
  initCommand,
  // Update
  updateCommand,
  // Process
  psCommand,
  killCommand,
  // Plugins
  pluginCommand,
];
