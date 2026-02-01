/**
 * Slash Command Parser for Slashbot
 */

import { c, colors, errorBlock, ThinkingAnimation } from '../ui/colors';
import { getLocalHistoryFile, HOME_SKILLS_DIR } from '../constants';

// Gather comprehensive codebase context for /init command
async function gatherCodebaseContext(): Promise<string> {
  let context = '# Comprehensive Codebase Analysis\n\n';
  const cwd = process.cwd();
  const folderName = path.basename(cwd);

  context += `**Folder:** \`${folderName}\`\n`;
  context += `**Path:** \`${cwd}\`\n\n`;

  // 1. Project basics with full package.json analysis
  context += '## Project Identity\n\n';
  try {
    const pkg = await Bun.file('package.json').json();
    context += `### package.json (full)\n\`\`\`json\n${JSON.stringify(pkg, null, 2)}\n\`\`\`\n\n`;
  } catch {
    context += '_No package.json found_\n\n';
  }

  // Check for other package managers
  for (const lockFile of ['bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']) {
    try {
      await Bun.file(lockFile).text();
      context += `**Lock file:** ${lockFile}\n`;
      break;
    } catch {}
  }
  context += '\n';

  // 2. Language Detection - analyze file extensions
  context += '## Languages & Frameworks\n\n';
  try {
    const extensions = await Bun.$`find . -type f -name "*.*" ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/.next/*" ! -path "*/build/*" 2>/dev/null | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`.text();
    context += `### File Extensions (by count)\n\`\`\`\n${extensions}\`\`\`\n\n`;
  } catch {}

  // 3. Complete Directory Structure
  context += '## Directory Structure\n\n';
  try {
    const tree = await Bun.$`find . -type d ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/.next/*" | head -50`.text();
    context += `\`\`\`\n${tree}\`\`\`\n\n`;
  } catch {}

  // List all files in src/ or main directories
  try {
    const srcFiles = await Bun.$`find src -type f 2>/dev/null | head -100`.text();
    if (srcFiles.trim()) {
      context += `### Source Files (src/)\n\`\`\`\n${srcFiles}\`\`\`\n\n`;
    }
  } catch {}

  try {
    const appFiles = await Bun.$`find app -type f 2>/dev/null | head -50`.text();
    if (appFiles.trim()) {
      context += `### App Files (app/)\n\`\`\`\n${appFiles}\`\`\`\n\n`;
    }
  } catch {}

  try {
    const libFiles = await Bun.$`find lib -type f 2>/dev/null | head -50`.text();
    if (libFiles.trim()) {
      context += `### Library Files (lib/)\n\`\`\`\n${libFiles}\`\`\`\n\n`;
    }
  } catch {}

  // 4. Code Styling & Formatting - FULL configs
  context += '## Code Style & Formatting\n\n';

  // ESLint - full config
  const eslintConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'];
  for (const config of eslintConfigs) {
    try {
      const content = await Bun.file(config).text();
      context += `### ESLint (${config})\n\`\`\`\n${content}\n\`\`\`\n\n`;
      break;
    } catch {}
  }

  // Prettier - full config
  const prettierConfigs = ['.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.mjs'];
  for (const config of prettierConfigs) {
    try {
      const content = await Bun.file(config).text();
      context += `### Prettier (${config})\n\`\`\`\n${content}\n\`\`\`\n\n`;
      break;
    } catch {}
  }

  // Biome
  try {
    const biome = await Bun.file('biome.json').text();
    context += `### Biome (biome.json)\n\`\`\`json\n${biome}\n\`\`\`\n\n`;
  } catch {}

  // EditorConfig
  try {
    const editorConfig = await Bun.file('.editorconfig').text();
    context += `### EditorConfig\n\`\`\`\n${editorConfig}\n\`\`\`\n\n`;
  } catch {}

  // 5. TypeScript Configuration - full
  try {
    const tsconfig = await Bun.file('tsconfig.json').text();
    context += `### TypeScript (tsconfig.json)\n\`\`\`json\n${tsconfig}\n\`\`\`\n\n`;
  } catch {}

  // 6. Build & Bundler configs
  context += '## Build & Bundler Configuration\n\n';

  const buildConfigs = [
    { name: 'vite.config.ts', lang: 'typescript' },
    { name: 'vite.config.js', lang: 'javascript' },
    { name: 'webpack.config.js', lang: 'javascript' },
    { name: 'rollup.config.js', lang: 'javascript' },
    { name: 'next.config.js', lang: 'javascript' },
    { name: 'next.config.mjs', lang: 'javascript' },
    { name: 'nuxt.config.ts', lang: 'typescript' },
    { name: 'astro.config.mjs', lang: 'javascript' },
    { name: 'svelte.config.js', lang: 'javascript' },
    { name: 'remix.config.js', lang: 'javascript' },
    { name: 'turbo.json', lang: 'json' },
  ];
  for (const cfg of buildConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 7. Testing Configuration
  context += '## Testing Configuration\n\n';
  const testConfigs = [
    { name: 'jest.config.js', lang: 'javascript' },
    { name: 'jest.config.ts', lang: 'typescript' },
    { name: 'vitest.config.ts', lang: 'typescript' },
    { name: 'playwright.config.ts', lang: 'typescript' },
    { name: 'cypress.config.ts', lang: 'typescript' },
  ];
  for (const cfg of testConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 8. Docker & Deployment
  context += '## Docker & Deployment\n\n';
  try {
    const dockerfile = await Bun.file('Dockerfile').text();
    context += `### Dockerfile\n\`\`\`dockerfile\n${dockerfile}\n\`\`\`\n\n`;
  } catch {}
  try {
    const compose = await Bun.file('docker-compose.yml').text();
    context += `### docker-compose.yml\n\`\`\`yaml\n${compose}\n\`\`\`\n\n`;
  } catch {}
  try {
    const compose2 = await Bun.file('docker-compose.yaml').text();
    context += `### docker-compose.yaml\n\`\`\`yaml\n${compose2}\n\`\`\`\n\n`;
  } catch {}

  // 9. Environment Variables
  context += '## Environment Variables\n\n';
  for (const envFile of ['.env.example', '.env.sample', '.env.template', '.env.local.example']) {
    try {
      const content = await Bun.file(envFile).text();
      context += `### ${envFile}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 10. Git Configuration
  context += '## Git & Repository\n\n';
  try {
    const gitignore = await Bun.file('.gitignore').text();
    context += `### .gitignore\n\`\`\`\n${gitignore}\n\`\`\`\n\n`;
  } catch {}

  // Recent commits
  try {
    const commits = await Bun.$`git log --oneline -20 2>/dev/null`.text();
    if (commits.trim()) {
      context += `### Recent Commits\n\`\`\`\n${commits}\`\`\`\n\n`;
    }
  } catch {}

  // 11. Existing Documentation
  context += '## Existing Documentation\n\n';
  const docFiles = ['README.md', 'CLAUDE.md', 'GROK.md', 'SLASHBOT.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/README.md'];
  for (const docFile of docFiles) {
    try {
      const content = await Bun.file(docFile).text();
      context += `### ${docFile}\n\`\`\`markdown\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 12. Entry Points - FULL content
  context += '## Entry Points (full source)\n\n';
  const entryFiles = ['src/index.ts', 'src/main.ts', 'src/app.ts', 'index.ts', 'main.ts', 'app.ts', 'src/index.js', 'src/main.js', 'pages/_app.tsx', 'app/layout.tsx', 'app/page.tsx'];
  for (const entry of entryFiles) {
    try {
      const content = await Bun.file(entry).text();
      context += `### ${entry}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 13. Core Source Files - read more files for pattern analysis
  context += '## Core Source Files\n\n';
  try {
    // Get all TypeScript/JavaScript files, prioritize by importance
    const importantPatterns = ['api', 'service', 'util', 'helper', 'config', 'types', 'model', 'schema', 'route', 'controller', 'handler', 'middleware'];

    for (const pattern of importantPatterns) {
      const files = await Bun.$`find src -type f \( -name "*${pattern}*.ts" -o -name "*${pattern}*.tsx" -o -name "*${pattern}*.js" \) 2>/dev/null | head -3`.text();
      const fileList = files.trim().split('\n').filter(f => f);

      for (const file of fileList) {
        try {
          const content = await Bun.file(file).text();
          context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
        } catch {}
      }
    }
  } catch {}

  // 14. Sample of other source files for patterns
  context += '## Code Samples (patterns)\n\n';
  try {
    const allFiles = await Bun.$`find src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | shuf | head -5`.text();
    const fileList = allFiles.trim().split('\n').filter(f => f);

    for (const file of fileList) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  // 15. Database & ORM
  context += '## Database & ORM\n\n';
  const dbConfigs = [
    { name: 'prisma/schema.prisma', lang: 'prisma' },
    { name: 'drizzle.config.ts', lang: 'typescript' },
    { name: 'knexfile.js', lang: 'javascript' },
    { name: 'ormconfig.json', lang: 'json' },
    { name: 'typeorm.config.ts', lang: 'typescript' },
  ];
  for (const cfg of dbConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // Migrations folder
  try {
    const migrations = await Bun.$`ls -la prisma/migrations 2>/dev/null || ls -la migrations 2>/dev/null || ls -la db/migrations 2>/dev/null`.text();
    if (migrations.trim()) {
      context += `### Migrations\n\`\`\`\n${migrations}\`\`\`\n\n`;
    }
  } catch {}

  // 16. API Routes
  context += '## API Routes\n\n';
  try {
    const apiRoutes = await Bun.$`find . -type f \( -path "*/api/*" -o -path "*/routes/*" -o -path "*/controllers/*" \) \( -name "*.ts" -o -name "*.js" \) ! -path "*/node_modules/*" 2>/dev/null | head -10`.text();
    const routeFiles = apiRoutes.trim().split('\n').filter(f => f);

    for (const file of routeFiles) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  // 17. Components (for frontend projects)
  context += '## UI Components\n\n';
  try {
    const components = await Bun.$`find . -type f \( -path "*/components/*" \) \( -name "*.tsx" -o -name "*.vue" -o -name "*.svelte" \) ! -path "*/node_modules/*" 2>/dev/null | head -5`.text();
    const componentFiles = components.trim().split('\n').filter(f => f);

    for (const file of componentFiles) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  return context;
}

export interface ParsedCommand {
  isCommand: boolean;
  command?: string;
  args: string[];
  rawArgs: string;
}

export interface CommandHandler {
  name: string;
  description: string;
  usage: string;
  execute: (args: string[], context: CommandContext) => Promise<boolean>;
}

export function parse(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return {
      isCommand: false,
      args: [],
      rawArgs: trimmed,
    };
  }
  const parts = trimmed.slice(1).trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return {
    isCommand: true,
    command,
    args,
    rawArgs: trimmed.slice(1),
  };
}

import type { GrokClient } from '../api/grok';
import type { TaskScheduler } from '../scheduler/scheduler';
import type { SecureFileSystem } from '../fs/filesystem';
import type { ConfigManager } from '../config/config';
import type { CodeEditor } from '../code/editor';
import type { SkillManager } from '../skills/manager';
import type { Interface as ReadlineInterface } from 'readline';

export interface ConnectorHandle {
  isRunning: () => boolean;
  sendMessage: (msg: string) => Promise<void>;
  stop?: () => void;
}

export interface CommandContext {
  grokClient: GrokClient | null;
  scheduler: TaskScheduler;
  fileSystem: SecureFileSystem;
  configManager: ConfigManager;
  codeEditor: CodeEditor;
  skillManager: SkillManager;
  connectors: Map<string, ConnectorHandle>;
  reinitializeGrok: () => Promise<void>;
  rl?: ReadlineInterface;
}

import clipboardy from 'clipboardy';
import terminalImage from 'terminal-image';
import * as path from 'path';
import { imageBuffer, addImage, getImage } from '../code/imageBuffer';

async function copyToClipboard(text: string) {
  try {
    await clipboardy.write(text);
    console.log(c.success('Copied to clipboard'));
  } catch (e) {
    console.log(c.error('Copy failed'));
  }
}

async function displayImage(n: number) {
  const imgPath = getImage(n);
  if (!imgPath) {
    console.log(c.error('Image not found'));
    return;
  }
  try {
    let image;
    if (imgPath.startsWith('data:image/')) {
      const base64Data = imgPath.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      image = await terminalImage.buffer(buffer);
    } else {
      image = await terminalImage.file(imgPath);
    }
    console.log(image);
  } catch (e) {
    console.log(c.error('Display failed'));
  }
}

export async function parseInput(input: string): Promise<ParsedCommand> {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return {
      isCommand: false,
      args: [],
      rawArgs: trimmed,
    };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const rawArgs = args.join(' ');

  // Auto handle /copy and /image here for simplicity
  if (command === 'copy') {
    await copyToClipboard(rawArgs || 'Last output');
    return { isCommand: false, args: [], rawArgs: '' }; // Consume
  }
  if (command === 'image' && args[0]) {
    const n = parseInt(args[0]);
    if (n > 0) {
      await displayImage(n);
      return { isCommand: false, args: [], rawArgs: '' };
    }
  }
  if (command === 'image-add' && args[0]) {
    addImage(args[0]);
    console.log(c.success(`Image added: Image${imageBuffer.length}`));
    return { isCommand: false, args: [], rawArgs: '' };
  }

  return {
    isCommand: true,
    command,
    args,
    rawArgs,
  };
}

// Built-in commands
export const commands: Map<string, CommandHandler> = new Map();

// /help or ? - Display available commands
commands.set('help', {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  execute: async args => {
    if (args.length > 0) {
      const cmd = commands.get(args[0]);
      if (cmd) {
        console.log(`\n${c.violet(cmd.name)} - ${cmd.description}`);
        console.log(`${c.muted('Usage:')} ${cmd.usage}\n`);
      } else {
        console.log(c.error(`Unknown command: ${args[0]}`));
      }
      return true;
    }

    console.log(`\n${c.violet(c.bold('Keyboard shortcuts:'))}\n`);
    console.log(`  ${c.violet('?')}           ${c.muted('Show this help')}`);
    console.log(`  ${c.violet('Ctrl+C')}      ${c.muted('Cancel / Quit')}`);

    console.log(`\n${c.violet(c.bold('Commands:'))}\n`);

    const cmdGroups = [
      { title: 'Session', cmds: ['login', 'logout', 'config'] },
      { title: 'Code', cmds: ['auth', 'init', 'grep', 'files'] },
      { title: 'Tasks', cmds: ['task', 'tasks'] },
      { title: 'Skills', cmds: ['skill', 'skills'] },
      { title: 'Files', cmds: ['read', 'write'] },
      { title: 'API', cmds: ['usage', 'context'] },
      { title: 'Personality', cmds: ['depressed', 'sarcasm', 'normal', 'unhinged'] },
      { title: 'Other', cmds: ['history', 'clear', 'exit'] },
    ];

    for (const group of cmdGroups) {
      for (const name of group.cmds) {
        const cmd = commands.get(name);
        if (cmd) {
          console.log(`  ${c.violet('/' + name.padEnd(10))} ${c.muted(cmd.description)}`);
        }
      }
    }

    console.log(`\n${c.muted('Use /help <command> for more details')}\n`);
    return true;
  },
});

// Alias ? for help
commands.set('?', {
  name: '?',
  description: 'Alias for /help',
  usage: '?',
  execute: async (args, context) => {
    return commands.get('help')!.execute(args, context);
  },
});

// /login - Enter API key
commands.set('login', {
  name: 'login',
  description: 'Enter Grok API key',
  usage: '/login <api_key>',
  execute: async (args, context) => {
    const apiKey = args.join(''); // Join in case key was split by spaces

    if (!apiKey) {
      console.log(`\n${c.violet('Connecting to Grok')}`);
      console.log(c.muted('Get your API key at https://console.x.ai/\n'));
      console.log(`${c.muted('Usage:')} /login <your_api_key>`);
      console.log(`${c.muted('Example:')} /login xai-xxxxxxxxxxxx\n`);
      return true;
    }

    // Validate key format
    if (!apiKey.startsWith('xai-') && apiKey.length < 20) {
      console.log(c.warning('Invalid key format'));
      console.log(c.muted('X.AI keys start with "xai-"'));
      return true;
    }

    try {
      await context.configManager.saveApiKey(apiKey);
      await context.reinitializeGrok();
      console.log(c.success('Connected to Grok!'));
    } catch (error) {
      console.log(c.error(`Error: ${error}`));
    }

    return true;
  },
});

// /logout - Clear API key
commands.set('logout', {
  name: 'logout',
  description: 'Log out (clear API key)',
  usage: '/logout',
  execute: async (_, context) => {
    await context.configManager.clearApiKey();
    console.log(c.success('Logged out. Use /login to reconnect.'));
    return true;
  },
});

// /config - Show configuration
commands.set('config', {
  name: 'config',
  description: 'Show configuration',
  usage: '/config',
  execute: async (_, context) => {
    const isAuth = context.configManager.isAuthenticated();
    const configDir = context.configManager.getConfigDir();

    console.log(`\n${c.violet('Slashbot Configuration')}\n`);
    console.log(
      `  ${c.muted('Status:')}     ${isAuth ? c.success('Connected') : c.warning('Not connected')}`,
    );
    console.log(`  ${c.muted('Model:')}      grok-4-1-fast-reasoning`);
    console.log(`  ${c.muted('Config:')}     ${configDir}`);

    const tasks = context.scheduler?.listTasks() || [];
    console.log(`\n  ${c.muted('Tasks:')}      ${tasks.length} scheduled`);

    console.log();
    return true;
  },
});

// /init - Initialize project context file using Grok AI analysis
commands.set('init', {
  name: 'init',
  description: 'Create project context file (GROK.md) using AI analysis',
  usage: '/init',
  execute: async (args, context) => {
    const workDir = context.codeEditor?.getWorkDir() || process.cwd();

    // Check if any context file already exists (CLAUDE.md, GROK.md, SLASHBOT.md)
    const contextFileNames = ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md'];
    for (const fileName of contextFileNames) {
      const existingPath = path.join(workDir, fileName);
      const existingFile = Bun.file(existingPath);
      if (await existingFile.exists()) {
        console.log(c.warning(`${fileName} already exists`));
        console.log(c.muted(`File: ${existingPath}`));
        console.log(c.muted('Delete it to create a new one'));
        return true;
      }
    }

    // Check if Grok client is available
    if (!context.grokClient) {
      console.log(
        c.error('Grok API not configured. Set GROK_API_KEY or XAI_API_KEY environment variable.'),
      );
      return true;
    }

    const contextFile = path.join(workDir, 'GROK.md');

    // Gather comprehensive codebase context
    console.log(c.muted('Gathering codebase context...'));
    const codebaseContext = await gatherCodebaseContext();

    // Create prompt for Grok to generate GROK.md
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

    console.log(c.muted('Asking Grok to analyze and generate GROK.md...'));

    // Call Grok API to generate the content
    const thinking = new ThinkingAnimation();
    thinking.start('Generating GROK.md...', workDir);

    try {
      const apiKey =
        context.configManager?.getApiKey() || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (!apiKey) {
        thinking.stop(); // Ignore duration on error
        console.log(
          c.error(
            'Grok API key not configured. Use /login or set GROK_API_KEY environment variable.',
          ),
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
          reasoning_effort: 'high',
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
        thinking.stop(); // Ignore duration on error
        const errorText = await response.text();
        console.log(c.error(`Grok API Error: ${response.status} - ${errorText}`));
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

      const duration = thinking.stop();

      if (!generatedContent.trim()) {
        console.log(c.error('Grok returned empty response'));
        return true;
      }

      // Write the AI-generated content
      await Bun.write(contextFile, generatedContent.trim());
      console.log(`${c.muted(duration)} ${c.success('File created: GROK.md')}`);
      console.log(c.muted('Generated by Grok AI based on codebase analysis'));
      console.log(c.muted('Compatible with CLAUDE.md and SLASHBOT.md'));
    } catch (error) {
      thinking.stop(); // Ignore duration on error
      console.log(c.error(`Error: ${error}`));
    }

    return true;
  },
});

// /grep - Search in code
commands.set('grep', {
  name: 'grep',
  description: 'Search in code',
  usage: '/grep <pattern> [file_pattern]',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      console.log(c.error('CodeEditor not available'));
      return true;
    }

    const pattern = args[0];
    const filePattern = args[1];

    if (!pattern) {
      console.log(c.error('Pattern required'));
      console.log(c.muted('Usage: /grep <pattern> [file_pattern]'));
      console.log(c.muted('Ex: /grep "function" *.ts'));
      return true;
    }

    const results = await context.codeEditor.grep(pattern, filePattern);

    if (results.length === 0) {
      console.log(c.muted('No results'));
    } else {
      console.log(`\n${c.violet(`Results for "${pattern}":`)}\n`);
      for (const result of results) {
        console.log(`  ${c.violet(result.file)}:${c.muted(String(result.line))}`);
        console.log(`    ${result.content}`);
      }
      console.log();
    }
    return true;
  },
});

// /files - List project files
commands.set('files', {
  name: 'files',
  description: 'List project files',
  usage: '/files [pattern]',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      console.log(c.error('CodeEditor not available'));
      return true;
    }

    const pattern = args[0];
    const files = await context.codeEditor.listFiles(pattern);

    if (files.length === 0) {
      console.log(c.muted('No files found'));
    } else {
      console.log(`\n${c.violet('Project files:')}\n`);
      files.forEach(f => console.log(`  ${c.muted(f)}`));
      console.log(`\n${c.muted(`Total: ${files.length} file(s)`)}\n`);
    }
    return true;
  },
});

// /task or /tasks - Manage scheduled tasks
commands.set('task', {
  name: 'task',
  description: 'Manage scheduled tasks',
  usage: '/task [list|run|remove|toggle|cron|clear] [id]',
  execute: async (args, context) => {
    const subcommand = args[0] || 'list';
    const tasks = context.scheduler?.listTasks() || [];
    const status = context.scheduler?.getStatus() || {};

    switch (subcommand) {
      case 'list':
        if (tasks.length === 0) {
          console.log(c.muted('\nNo scheduled tasks'));
          console.log(c.muted('Ask Slashbot to create a task in natural language.\n'));
        } else {
          console.log(
            `\n${c.violet('Scheduled tasks:')} ${status.running ? c.success('(running)') : c.warning('(stopped)')}\n`,
          );
          tasks.forEach((task: any, i: number) => {
            const statusIcon = task.enabled ? c.success('●') : c.muted('○');
            console.log(`  ${statusIcon} ${c.violet(`[${i + 1}]`)} ${task.name}`);
            console.log(`      ${c.muted('Cron:')}    ${task.cron}`);
            console.log(
              `      ${c.muted('Command:')} ${task.command.slice(0, 50)}${task.command.length > 50 ? '...' : ''}`,
            );
            console.log(
              `      ${c.muted('Next:')}    ${task.next}  ${c.muted(`(${task.runs} runs)`)}`,
            );
          });
          console.log(`\n${c.muted('Commands: /task run|remove|toggle|cron <id>')}\n`);
        }
        break;

      case 'run':
        const runId = parseInt(args[1]) - 1;
        if (isNaN(runId) || runId < 0 || runId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task run <id>'));
          return true;
        }

        const taskToRun = tasks[runId];
        console.log(c.muted(`Running: ${taskToRun.name}...`));
        if (await context.scheduler?.runTask(runId)) {
          // Output is shown by the scheduler
        } else {
          console.log(c.error('Run error'));
        }
        break;

      case 'remove':
      case 'delete':
      case 'rm':
        const removeId = parseInt(args[1]) - 1;
        if (isNaN(removeId) || removeId < 0 || removeId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task remove <id>'));
          return true;
        }

        const taskToRemove = tasks[removeId];
        if (await context.scheduler?.removeTask(removeId)) {
          console.log(c.success(`Removed: ${taskToRemove.name}`));
        } else {
          console.log(c.error('Remove error'));
        }
        break;

      case 'toggle':
        const toggleId = parseInt(args[1]) - 1;
        if (isNaN(toggleId) || toggleId < 0 || toggleId >= tasks.length) {
          console.log(c.error('Invalid ID. Usage: /task toggle <id>'));
          return true;
        }

        const enabled = await context.scheduler?.toggleTask(toggleId);
        const taskToggled = tasks[toggleId];
        console.log(
          enabled
            ? c.success(`Enabled: ${taskToggled.name}`)
            : c.warning(`Disabled: ${taskToggled.name}`),
        );
        break;

      case 'cron':
        const cronId = parseInt(args[1]) - 1;
        const newCron = args.slice(2).join(' ');
        if (isNaN(cronId) || cronId < 0 || cronId >= tasks.length || !newCron) {
          console.log(c.error('Usage: /task cron <id> <expression>'));
          console.log(c.muted('Ex: /task cron 1 0 8 * * *  (daily at 8am)'));
          return true;
        }

        if (await context.scheduler?.updateTaskCron(cronId, newCron)) {
          console.log(c.success(`Cron updated: ${newCron}`));
        } else {
          console.log(c.error('Update error'));
        }
        break;

      case 'clear':
        if (tasks.length === 0) {
          console.log(c.muted('No tasks'));
          return true;
        }

        await context.scheduler?.clearTasks();
        console.log(c.success(`${tasks.length} task(s) removed`));
        break;

      case 'status':
        console.log(`\n${c.violet('Scheduler status:')}\n`);
        console.log(
          `  ${c.muted('Running:')}  ${status.running ? c.success('Yes') : c.warning('No')}`,
        );
        console.log(`  ${c.muted('Tasks:')}    ${status.taskCount}`);
        console.log(`  ${c.muted('Active:')}   ${status.activeCount}\n`);
        break;

      default:
        console.log(c.muted('Commands: list, run, remove, toggle, cron, clear, status'));
    }

    return true;
  },
});

// Alias /tasks for /task
commands.set('tasks', {
  name: 'tasks',
  description: 'Alias for /task',
  usage: '/tasks',
  execute: async (args, context) => {
    return commands.get('task')!.execute(args, context);
  },
});

// /read - Read a file
commands.set('read', {
  name: 'read',
  description: 'Read a local file',
  usage: '/read <path>',
  execute: async (args, context) => {
    const filePath = args[0];
    if (!filePath) {
      console.log(c.error('File path required'));
      return true;
    }

    try {
      const content = await context.fileSystem?.readFile(filePath);
      console.log(`\n${c.violet(`─── ${filePath} ───`)}\n`);
      console.log(content);
      console.log(`\n${c.violet('─── end ───')}\n`);
    } catch (error) {
      console.log(c.error(`Could not read file: ${error}`));
    }
    return true;
  },
});

// /write - Write to a file (with confirmation)
commands.set('write', {
  name: 'write',
  description: 'Write to a file',
  usage: '/write <path> <content>',
  execute: async (args, context) => {
    const filePath = args[0];
    const content = args.slice(1).join(' ');

    if (!filePath) {
      console.log(c.error('Usage: /write <path> <content>'));
      return true;
    }

    if (!content) {
      console.log(c.error('Content missing'));
      console.log(c.muted('Usage: /write <path> <content>'));
      return true;
    }

    const result = await context.fileSystem?.writeFile(filePath, content);
    if (result) {
      console.log(c.success(`File written: ${filePath}`));
    }
    return true;
  },
});

// /clear - Clear conversation history
commands.set('clear', {
  name: 'clear',
  description: 'Clear conversation history',
  usage: '/clear',
  execute: async (_, context) => {
    context.grokClient?.clearHistory();
    console.clear();
    console.log(c.success('Conversation history cleared'));
    return true;
  },
});

// /history - Show command history
commands.set('history', {
  name: 'history',
  description: 'Show command history',
  usage: '/history [n]',
  execute: async args => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);

      if (!(await file.exists())) {
        console.log(c.muted('No history'));
        return true;
      }

      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      const recent = lines.slice(-limit);

      console.log(`\n${c.violet('Command history:')}\n`);
      recent.forEach((line, i) => {
        const num = lines.length - recent.length + i + 1;
        console.log(`  ${c.muted(String(num).padStart(4))}  ${line}`);
      });
      console.log();
    } catch {
      console.log(c.muted('Could not read history'));
    }

    return true;
  },
});

// /context - Manage context compression
commands.set('context', {
  name: 'context',
  description: 'Manage context compression',
  usage: '/context [on|off|status] [max_messages]',
  execute: async (args, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const subcommand = args[0] || 'status';

    switch (subcommand) {
      case 'on':
        const maxMsgs = parseInt(args[1]) || 20;
        context.grokClient.setContextCompression(true, maxMsgs);
        console.log(c.success(`Compression enabled (max ${maxMsgs} messages)`));
        break;

      case 'off':
        context.grokClient.setContextCompression(false);
        console.log(c.success('Compression disabled'));
        break;

      case 'status':
      default:
        const enabled = context.grokClient.isContextCompressionEnabled();
        const maxMessages = context.grokClient.getMaxContextMessages();
        const contextSize = context.grokClient.getContextSize();
        const estimatedTokens = context.grokClient.estimateTokens();

        console.log(`\n${c.violet('Context:')}\n`);
        console.log(
          `  ${c.muted('Compression:')}  ${enabled ? c.success('Enabled') : c.warning('Disabled')}`,
        );
        console.log(`  ${c.muted('Max messages:')} ${maxMessages}`);
        console.log(`  ${c.muted('Messages:')}     ${contextSize}`);
        console.log(`  ${c.muted('Tokens (~):')}   ${estimatedTokens.toLocaleString()}`);
        console.log(`\n${c.muted('Usage: /context on [max] | /context off')}\n`);
        break;
    }

    return true;
  },
});

// /usage - Show Grok API usage
commands.set('usage', {
  name: 'usage',
  description: 'Show Grok API usage',
  usage: '/usage [reset]',
  execute: async (args, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    if (args[0] === 'reset') {
      context.grokClient.resetUsage();
      console.log(c.success('Statistics reset'));
      return true;
    }

    const usage = context.grokClient.getUsage();
    const contextSize = context.grokClient.getContextSize();
    const estimatedTokens = context.grokClient.estimateTokens();

    console.log(`\n${c.violet('Grok API Usage:')}\n`);
    console.log(`  ${c.muted('Requests:')}      ${usage.requests}`);
    console.log(`  ${c.muted('Prompt:')}        ${usage.promptTokens.toLocaleString()} tokens`);
    console.log(`  ${c.muted('Completion:')}    ${usage.completionTokens.toLocaleString()} tokens`);
    console.log(`  ${c.muted('Total:')}         ${usage.totalTokens.toLocaleString()} tokens`);
    console.log(`\n${c.violet('Current context:')}\n`);
    console.log(`  ${c.muted('Messages:')}      ${contextSize}`);
    console.log(`  ${c.muted('Tokens (~):')}    ${estimatedTokens.toLocaleString()}`);
    console.log(`\n${c.muted('/usage reset to reset statistics')}\n`);

    return true;
  },
});

// /exit - Quit the application
commands.set('exit', {
  name: 'exit',
  description: 'Quit Slashbot',
  usage: '/exit',
  execute: async (_, context) => {
    console.log(c.violet('\nGoodbye!\n'));
    // Stop the scheduler to clean up cron intervals
    context.scheduler.stop();
    process.exit(0);
  },
});

// /ps - List background processes
commands.set('ps', {
  name: 'ps',
  description: 'List background processes',
  usage: '/ps',
  execute: async () => {
    const { processManager } = await import('../utils/processManager');
    const processes = processManager.list();

    if (processes.length === 0) {
      console.log(c.muted('No background processes running'));
      return true;
    }

    console.log(c.bold('Background Processes:\n'));
    for (const proc of processes) {
      const status = proc.running ? c.success('●') : c.error('○');
      console.log(`${status} ${c.bold(proc.id)} (PID ${proc.pid}) - ${proc.uptime}`);
      console.log(`  ${c.muted(proc.command)}`);
      if (proc.lastOutput) {
        console.log(`  ${c.muted('└ ' + proc.lastOutput.slice(0, 60))}`);
      }
    }
    return true;
  },
});

// /kill - Kill a background process
commands.set('kill', {
  name: 'kill',
  description: 'Kill a background process',
  usage: '/kill <id|pid>',
  execute: async args => {
    const target = args[0];
    if (!target) {
      console.log(c.error('Usage: /kill <id|pid>'));
      console.log(c.muted('Use /ps to list processes'));
      return true;
    }

    const { processManager } = await import('../utils/processManager');
    const pid = parseInt(target);
    const success = processManager.kill(isNaN(pid) ? target : pid);

    if (success) {
      console.log(c.success(`Killed process: ${target}`));
    } else {
      console.log(c.error(`Failed to kill process: ${target}`));
      console.log(c.muted('Use /ps to list running processes'));
    }
    return true;
  },
});

// /telegram - Configure Telegram bot
commands.set('telegram', {
  name: 'telegram',
  description: 'Configure Telegram bot connection',
  usage: '/telegram <bot_token> [chat_id]',
  execute: async (args, context) => {
    const botToken = args[0];
    const chatId = args[1];

    if (!botToken) {
      // Show current status and usage
      const telegramConfig = context.configManager.getTelegramConfig();
      const connector = context.connectors.get('telegram');

      console.log(`\n${c.violet('Telegram Configuration')}\n`);

      if (telegramConfig) {
        console.log(
          `  ${c.muted('Status:')}  ${connector?.isRunning() ? c.success('Connected') : c.warning('Configured but not running')}`,
        );
        console.log(`  ${c.muted('Bot:')}     ${telegramConfig.botToken.slice(0, 10)}...`);
        console.log(`  ${c.muted('Chat ID:')} ${telegramConfig.chatId}`);
      } else {
        console.log(`  ${c.muted('Status:')}  ${c.warning('Not configured')}`);
      }

      console.log(`\n${c.muted('Usage:')}`);
      console.log(`  ${c.violet('/telegram <bot_token> <chat_id>')} - Configure bot`);
      console.log(`  ${c.violet('/telegram <bot_token>')}           - Auto-detect chat_id`);
      console.log(`  ${c.violet('/telegram clear')}                 - Remove configuration`);
      console.log(`\n${c.muted('Get bot token from @BotFather on Telegram')}\n`);
      return true;
    }

    // Handle clear command
    if (botToken === 'clear') {
      await context.configManager.clearTelegramConfig();
      const connector = context.connectors.get('telegram');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('telegram');
      }
      console.log(c.success('Telegram configuration cleared'));
      return true;
    }

    // Validate token format
    if (!botToken.includes(':')) {
      console.log(c.error('Invalid bot token format'));
      console.log(c.muted('Token should be like: 123456789:ABCdefGHI...'));
      return true;
    }

    let finalChatId = chatId;

    // Auto-detect chat_id if not provided
    if (!finalChatId) {
      console.log(c.muted('Fetching chat_id from Telegram...'));
      console.log(c.muted('(Make sure you sent a message to your bot first)'));

      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
        const data = (await response.json()) as {
          ok: boolean;
          result: Array<{ message?: { chat?: { id: number } } }>;
        };

        if (!data.ok) {
          console.log(c.error('Invalid bot token'));
          return true;
        }

        // Find the first chat_id from updates
        const update = data.result?.find((u: any) => u.message?.chat?.id);
        if (update?.message?.chat?.id) {
          finalChatId = String(update.message.chat.id);
          console.log(c.success(`Found chat_id: ${finalChatId}`));
        } else {
          console.log(
            c.warning(
              'No messages found. Send a message to your bot first, then run this command again.',
            ),
          );
          return true;
        }
      } catch (error) {
        console.log(c.error(`Error: ${error}`));
        return true;
      }
    }

    // Save configuration
    try {
      await context.configManager.saveTelegramConfig(botToken, finalChatId);
      console.log(c.success('Telegram configured!'));
      console.log(c.muted(`Bot token: ${botToken.slice(0, 10)}...`));
      console.log(c.muted(`Chat ID: ${finalChatId}`));
      console.log(c.warning('\nRestart slashbot to connect to Telegram'));
    } catch (error) {
      console.log(c.error(`Error saving config: ${error}`));
    }

    return true;
  },
});

// /discord - Configure Discord bot
commands.set('discord', {
  name: 'discord',
  description: 'Configure Discord bot connection',
  usage: '/discord <bot_token> <channel_id>',
  execute: async (args, context) => {
    const botToken = args[0];
    const channelId = args[1];

    if (!botToken) {
      // Show current status and usage
      const discordConfig = context.configManager.getDiscordConfig();
      const connector = context.connectors.get('discord');

      console.log(`\n${c.violet('Discord Configuration')}\n`);

      if (discordConfig) {
        console.log(
          `  ${c.muted('Status:')}     ${connector?.isRunning() ? c.success('Connected') : c.warning('Configured but not running')}`,
        );
        console.log(`  ${c.muted('Bot:')}        ${discordConfig.botToken.slice(0, 20)}...`);
        console.log(`  ${c.muted('Channel ID:')} ${discordConfig.channelId}`);
      } else {
        console.log(`  ${c.muted('Status:')}  ${c.warning('Not configured')}`);
      }

      console.log(`\n${c.muted('Usage:')}`);
      console.log(`  ${c.violet('/discord <bot_token> <channel_id>')} - Configure bot`);
      console.log(`  ${c.violet('/discord clear')}                    - Remove configuration`);
      console.log(`\n${c.muted('Get bot token from Discord Developer Portal')}`);
      console.log(
        `${c.muted('Channel ID: Right-click channel > Copy ID (enable Developer Mode)')}\n`,
      );
      return true;
    }

    // Handle clear command
    if (botToken === 'clear') {
      await context.configManager.clearDiscordConfig();
      const connector = context.connectors.get('discord');
      if (connector) {
        connector.stop?.();
        context.connectors.delete('discord');
      }
      console.log(c.success('Discord configuration cleared'));
      return true;
    }

    // Require channel_id
    if (!channelId) {
      console.log(c.error('Channel ID required'));
      console.log(c.muted('Usage: /discord <bot_token> <channel_id>'));
      console.log(c.muted('Get Channel ID: Right-click channel > Copy ID'));
      return true;
    }

    // Save configuration
    try {
      await context.configManager.saveDiscordConfig(botToken, channelId);
      console.log(c.success('Discord configured!'));
      console.log(c.muted(`Bot token: ${botToken.slice(0, 20)}...`));
      console.log(c.muted(`Channel ID: ${channelId}`));
      console.log(c.warning('\nRestart slashbot to connect to Discord'));
    } catch (error) {
      console.log(c.error(`Error saving config: ${error}`));
    }

    return true;
  },
});

// /depressed - Depressed bot mode
commands.set('depressed', {
  name: 'depressed',
  description: 'Enable depressed bot mode',
  usage: '/depressed',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'depressed') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('*sigh* Fine, back to normal... not that it matters...'));
    } else {
      context.grokClient.setPersonality('depressed');
      console.log(c.muted('*sigh* Depressed mode enabled... everything is meaningless anyway...'));
    }
    return true;
  },
});

// /sarcasm - Sarcastic bot mode
commands.set('sarcasm', {
  name: 'sarcasm',
  description: 'Enable sarcastic bot mode',
  usage: '/sarcasm',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'sarcasm') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('Oh, you want me to be nice now? How refreshing.'));
    } else {
      context.grokClient.setPersonality('sarcasm');
      console.log(c.warning('Sarcasm mode enabled. This is going to be fun. 🙄'));
    }
    return true;
  },
});

// /normal - Reset to normal mode
commands.set('normal', {
  name: 'normal',
  description: 'Reset to normal bot mode',
  usage: '/normal',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    context.grokClient.setPersonality('normal');
    console.log(c.success('Back to normal mode'));
    return true;
  },
});

// /unhinged - Toggle unhinged mode
commands.set('unhinged', {
  name: 'unhinged',
  description: 'Toggle unhinged mode (chaotic responses)',
  usage: '/unhinged',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'unhinged') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('Sanity restored. Back to boring mode.'));
    } else {
      context.grokClient.setPersonality('unhinged');
      console.log(colors.violet + 'UNHINGED MODE ACTIVATED - Chaos unleashed! 🔥' + '\x1b[0m');
    }
    return true;
  },
});

export async function executeCommand(
  parsed: ParsedCommand,
  context: CommandContext,
): Promise<boolean> {
  if (!parsed.isCommand || !parsed.command) {
    return false;
  }

  const handler = commands.get(parsed.command);

  if (!handler) {
    console.log(c.error(`Unknown command: /${parsed.command}`));
    console.log(c.muted('Use /help to see available commands'));
    return true;
  }

  return handler.execute(parsed.args, context);
}

commands.set('ls', {
  name: 'ls',
  description: 'List directory contents (alias for files)',
  usage: 'ls [pattern]',
  execute: async (args, context) => {
    const filesCmd = commands.get('files');
    if (filesCmd && context.codeEditor) {
      return filesCmd.execute(args, context);
    }
    console.log(c.error('Files command not available'));
    return true;
  },
});

// /skill - Manage skills
commands.set('skill', {
  name: 'skill',
  description: 'Manage skills (install, list, remove)',
  usage: '/skill [list|install|remove|info] [url/name]',
  execute: async (args, context) => {
    if (!context.skillManager) {
      console.log(c.error('SkillManager not available'));
      return true;
    }

    const subcommand = args[0] || 'list';

    switch (subcommand) {
      case 'list':
      case 'ls':
        const skills = await context.skillManager.listSkills();
        if (skills.length === 0) {
          console.log(c.muted('\nNo skills installed'));
          console.log(c.muted('Install with: /skill install <url>'));
          console.log(c.muted(`Skills are stored in ${HOME_SKILLS_DIR}/\n`));
        } else {
          console.log(`\n${c.violet('Installed skills:')}\n`);
          for (const skill of skills) {
            const desc = skill.metadata?.description || 'No description';
            const version = skill.metadata?.version ? ` v${skill.metadata.version}` : '';
            console.log(`  ${c.violet(skill.name)}${c.muted(version)}`);
            console.log(`    ${c.muted(desc)}`);
          }
          console.log(`\n${c.muted('Use /skill info <name> for details')}\n`);
        }
        break;

      case 'install':
      case 'add':
        const url = args[1];
        const customName = args[2];
        if (!url) {
          console.log(c.error('URL required'));
          console.log(c.muted('Usage: /skill install <url> [name]'));
          console.log(c.muted('Example: /skill install https://example.com/skill.md myskill'));
          return true;
        }

        try {
          console.log(c.muted(`Downloading skill from ${url}...`));
          const skill = await context.skillManager.installSkill(url, customName);
          console.log(c.success(`Skill installed: ${skill.name}`));
          console.log(c.muted(`Path: ${skill.path}`));
          // Reinitialize Grok to update system prompt with new skill
          await context.reinitializeGrok();
        } catch (error) {
          console.log(c.error(`Failed to install skill: ${error}`));
        }
        break;

      case 'remove':
      case 'rm':
      case 'delete':
        const nameToRemove = args[1];
        if (!nameToRemove) {
          console.log(c.error('Skill name required'));
          console.log(c.muted('Usage: /skill remove <name>'));
          return true;
        }

        if (await context.skillManager.removeSkill(nameToRemove)) {
          console.log(c.success(`Skill removed: ${nameToRemove}`));
          // Reinitialize Grok to update system prompt
          await context.reinitializeGrok();
        } else {
          console.log(c.error(`Skill not found: ${nameToRemove}`));
        }
        break;

      case 'info':
        const skillName = args[1];
        if (!skillName) {
          console.log(c.error('Skill name required'));
          console.log(c.muted('Usage: /skill info <name>'));
          return true;
        }

        const skill = await context.skillManager.getSkill(skillName);
        if (skill) {
          console.log(`\n${c.violet(`Skill: ${skill.name}`)}\n`);
          if (skill.metadata?.description) {
            console.log(`  ${c.muted('Description:')} ${skill.metadata.description}`);
          }
          if (skill.metadata?.version) {
            console.log(`  ${c.muted('Version:')} ${skill.metadata.version}`);
          }
          if (skill.metadata?.homepage) {
            console.log(`  ${c.muted('Homepage:')} ${skill.metadata.homepage}`);
          }
          if (skill.metadata?.triggers && skill.metadata.triggers.length > 0) {
            console.log(`  ${c.muted('Triggers:')} ${skill.metadata.triggers.join(', ')}`);
          }
          console.log(`  ${c.muted('Path:')} ${skill.path}`);
          console.log(`  ${c.muted('Size:')} ${skill.content.length} chars\n`);

          // Show first few lines of content
          const preview = skill.content.split('\n').slice(0, 10).join('\n');
          console.log(`${c.muted('─── Preview ───')}`);
          console.log(preview);
          if (skill.content.split('\n').length > 10) {
            console.log(c.muted(`... and ${skill.content.split('\n').length - 10} more lines`));
          }
          console.log();
        } else {
          console.log(c.error(`Skill not found: ${skillName}`));
        }
        break;

      case 'dir':
      case 'path':
        console.log(`\n${c.muted('Skills directory:')} ${context.skillManager.getSkillsDir()}\n`);
        break;

      default:
        console.log(c.muted('Commands: list, install <url>, remove <name>, info <name>, dir'));
    }

    return true;
  },
});

// Alias /skills for /skill
commands.set('skills', {
  name: 'skills',
  description: 'Alias for /skill',
  usage: '/skills',
  execute: async (args, context) => {
    return commands.get('skill')!.execute(args, context);
  },
});

// /paste-image or /pi - Paste image from clipboard
commands.set('paste-image', {
  name: 'paste-image',
  description: 'Paste image from system clipboard',
  usage: '/paste-image',
  execute: async () => {
    const { readImageFromClipboard } = await import('../ui/pasteHandler');
    const { addImage, imageBuffer } = await import('../code/imageBuffer');

    console.log(c.muted('Reading clipboard...'));
    const dataUrl = await readImageFromClipboard();

    if (dataUrl) {
      addImage(dataUrl);
      const sizeKB = Math.round(dataUrl.length / 1024);
      console.log(c.success(`🖼️  Image pasted from clipboard (${sizeKB}KB)`));
      console.log(c.muted('   Now ask a question about the image'));
    } else {
      console.log(c.warning('No image found in clipboard'));
      console.log(c.muted('   Linux: install xclip (X11) or wl-clipboard (Wayland)'));
      console.log(c.muted('   Copy an image to clipboard first'));
    }
    return true;
  },
});

// Alias /pi for /paste-image
commands.set('pi', {
  name: 'pi',
  description: 'Alias for /paste-image',
  usage: '/pi',
  execute: async (args, context) => {
    return commands.get('paste-image')!.execute(args, context);
  },
});

// Get all command names for autocomplete
export function getCommandNames(): string[] {
  return Array.from(commands.keys()).map(cmd => `/${cmd}`);
}

// Completer function for readline
export function completer(line: string): [string[], string] {
  const commandNames = getCommandNames();

  if (line.startsWith('/')) {
    const hits = commandNames.filter(cmd => cmd.startsWith(line));
    return [hits.length ? hits : commandNames, line];
  }

  return [[], line];
}
