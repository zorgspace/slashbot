/**
 * Slash Command Parser for Slashbot
 */

import { c } from '../ui/colors';

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

export interface CommandContext {
  grokClient: any;
  scheduler: any;
  notifier: any;
  fileSystem: any;
  configManager: any;
  codeEditor: any;
  reinitializeGrok: () => Promise<void>;
  rl?: any;
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
  execute: async (args) => {
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
      { title: 'Notifications', cmds: ['notify'] },
      { title: 'Files', cmds: ['read', 'write'] },
      { title: 'API', cmds: ['usage', 'context'] },
      { title: 'Personality', cmds: ['depressed', 'sarcasm', 'normal'] },
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
    console.log(`  ${c.muted('Status:')}     ${isAuth ? c.success('Connected') : c.warning('Not connected')}`);
    console.log(`  ${c.muted('Model:')}      grok-4-1-fast-reasoning`);
    console.log(`  ${c.muted('Config:')}     ${configDir}`);

    const notifyStatus = context.notifier?.getStatus() || {};
    console.log(`\n  ${c.muted('Telegram:')}   ${notifyStatus.telegram ? c.success('Configured') : c.muted('Not configured')}`);
    console.log(`  ${c.muted('WhatsApp:')}   ${notifyStatus.whatsapp ? c.success('Configured') : c.muted('Not configured')}`);

    const tasks = context.scheduler?.listTasks() || [];
    console.log(`\n  ${c.muted('Tasks:')}      ${tasks.length} scheduled`);

    console.log();
    return true;
  },
});

// /auth - Authorize code editing in current directory
commands.set('auth', {
  name: 'auth',
  description: 'Authorize code editing in this folder',
  usage: '/auth [revoke]',
  execute: async (args, context) => {
    if (!context.codeEditor) {
      console.log(c.error('CodeEditor not available'));
      return true;
    }

    if (args[0] === 'revoke') {
      await context.codeEditor.revoke();
      return true;
    }

    const isAuthorized = await context.codeEditor.isAuthorized();
    if (isAuthorized) {
      console.log(c.success('Already authorized for this folder'));
      console.log(c.muted(`Folder: ${context.codeEditor.getWorkDir()}`));
      console.log(c.muted('Use /auth revoke to revoke'));
    } else {
      await context.codeEditor.authorize();
    }
    return true;
  },
});

// /init - Initialize project context file
commands.set('init', {
  name: 'init',
  description: 'Create project context file (GROK.md)',
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

    const contextFile = path.join(workDir, 'GROK.md');

    console.log(c.muted('Analyzing project...'));

    // Gather project information
    let projectName = path.basename(workDir);
    let projectDescription = '';
    let techStack: string[] = [];
    let buildCommands: string[] = [];
    let testCommands: string[] = [];

    // Try to read package.json
    const packageJsonPath = path.join(workDir, 'package.json');
    const packageJsonFile = Bun.file(packageJsonPath);
    if (await packageJsonFile.exists()) {
      try {
        const pkg = await packageJsonFile.json();
        projectName = pkg.name || projectName;
        projectDescription = pkg.description || '';

        // Detect tech stack from dependencies
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.typescript || deps['@types/node']) techStack.push('TypeScript');
        if (deps.react || deps['react-dom']) techStack.push('React');
        if (deps.vue) techStack.push('Vue');
        if (deps.express) techStack.push('Express');
        if (deps.fastify) techStack.push('Fastify');
        if (deps.next) techStack.push('Next.js');
        if (deps.bun || deps['bun-types']) techStack.push('Bun');
        if (deps.jest) techStack.push('Jest');
        if (deps.vitest) techStack.push('Vitest');
        if (deps.tailwindcss) techStack.push('Tailwind CSS');
        if (deps.prisma || deps['@prisma/client']) techStack.push('Prisma');

        // Extract scripts
        if (pkg.scripts) {
          if (pkg.scripts.build) buildCommands.push(`bun run build`);
          if (pkg.scripts.dev) buildCommands.push(`bun run dev`);
          if (pkg.scripts.test) testCommands.push(`bun run test`);
          if (pkg.scripts.lint) testCommands.push(`bun run lint`);
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Try to read pyproject.toml or requirements.txt for Python
    const pyprojectPath = path.join(workDir, 'pyproject.toml');
    const requirementsPath = path.join(workDir, 'requirements.txt');
    if (await Bun.file(pyprojectPath).exists() || await Bun.file(requirementsPath).exists()) {
      techStack.push('Python');
    }

    // Try to read Cargo.toml for Rust
    const cargoPath = path.join(workDir, 'Cargo.toml');
    if (await Bun.file(cargoPath).exists()) {
      techStack.push('Rust');
      buildCommands.push('cargo build');
      testCommands.push('cargo test');
    }

    // Try to read go.mod for Go
    const goModPath = path.join(workDir, 'go.mod');
    if (await Bun.file(goModPath).exists()) {
      techStack.push('Go');
      buildCommands.push('go build');
      testCommands.push('go test ./...');
    }

    // Get directory structure
    const files = await context.codeEditor?.listFiles() || [];
    const dirs = new Set<string>();
    for (const file of files.slice(0, 100)) {
      const dir = path.dirname(file);
      if (dir !== '.' && dir !== '') {
        const topDir = dir.split('/')[0];
        dirs.add(topDir);
      }
    }

    // Generate SLASHBOT.md content
    let content = `# ${projectName}\n\n`;

    if (projectDescription) {
      content += `${projectDescription}\n\n`;
    }

    content += `## Tech Stack\n\n`;
    if (techStack.length > 0) {
      content += techStack.map(t => `- ${t}`).join('\n') + '\n\n';
    } else {
      content += `- (to be completed)\n\n`;
    }

    content += `## Structure\n\n`;
    content += `\`\`\`\n`;
    content += `${projectName}/\n`;
    for (const dir of Array.from(dirs).sort().slice(0, 15)) {
      content += `├── ${dir}/\n`;
    }
    content += `\`\`\`\n\n`;

    content += `## Commands\n\n`;
    if (buildCommands.length > 0 || testCommands.length > 0) {
      if (buildCommands.length > 0) {
        content += `### Build\n\n`;
        content += buildCommands.map(cmd => `\`\`\`bash\n${cmd}\n\`\`\``).join('\n\n') + '\n\n';
      }
      if (testCommands.length > 0) {
        content += `### Test\n\n`;
        content += testCommands.map(cmd => `\`\`\`bash\n${cmd}\n\`\`\``).join('\n\n') + '\n\n';
      }
    } else {
      content += `(to be completed)\n\n`;
    }

    content += `## Conventions\n\n`;
    content += `- (add code conventions here)\n\n`;

    content += `## Notes\n\n`;
    content += `- (add important notes for AI context)\n`;

    // Write the file
    try {
      await Bun.write(contextFile, content);
      console.log(c.success(`File created: GROK.md`));
      console.log(c.muted('Edit this file to add more context'));
      console.log(c.muted('Compatible with CLAUDE.md and SLASHBOT.md'));
    } catch (error) {
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
      const isAuthorized = await context.codeEditor.isAuthorized();
      if (!isAuthorized) {
        console.log(c.warning('Not authorized. Use /auth to authorize.'));
      }
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
          console.log(`\n${c.violet('Scheduled tasks:')} ${status.running ? c.success('(running)') : c.warning('(stopped)')}\n`);
          tasks.forEach((task: any, i: number) => {
            const statusIcon = task.enabled ? c.success('●') : c.muted('○');
            console.log(`  ${statusIcon} ${c.violet(`[${i + 1}]`)} ${task.name}`);
            console.log(`      ${c.muted('Cron:')}    ${task.cron}`);
            console.log(`      ${c.muted('Command:')} ${task.command.slice(0, 50)}${task.command.length > 50 ? '...' : ''}`);
            console.log(`      ${c.muted('Next:')}    ${task.next}  ${c.muted(`(${task.runs} runs)`)}`);
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
        console.log(enabled
          ? c.success(`Enabled: ${taskToggled.name}`)
          : c.warning(`Disabled: ${taskToggled.name}`));
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
        console.log(`  ${c.muted('Running:')}  ${status.running ? c.success('Yes') : c.warning('No')}`);
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

// /notify - Configure notifications
commands.set('notify', {
  name: 'notify',
  description: 'Configure notifications',
  usage: '/notify telegram <token> <chat_id> | /notify whatsapp <webhook_url> | /notify test',
  execute: async (args, context) => {
    const service = args[0];

    if (!service) {
      const status = context.notifier?.getStatus() || {};
      console.log(`\n${c.violet('Notifications configuration:')}\n`);
      console.log(`  ${c.violet('Telegram:')} ${status.telegram ? c.success('Configured') : c.muted('Not configured')}`);
      console.log(`  ${c.violet('WhatsApp:')} ${status.whatsapp ? c.success('Configured') : c.muted('Not configured')}`);
      console.log(`\n${c.muted('Usage:')}`);
      console.log(`  ${c.muted('/notify telegram <bot_token> <chat_id>')}`);
      console.log(`  ${c.muted('/notify whatsapp <webhook_url>')}`);
      console.log(`  ${c.muted('/notify test')}\n`);
      return true;
    }

    if (service === 'telegram') {
      const token = args[1];
      const chatId = args[2];

      if (!token || !chatId) {
        console.log(c.error('Missing parameters'));
        console.log(c.muted('Usage: /notify telegram <bot_token> <chat_id>'));
        return true;
      }

      context.notifier?.configureTelegram(token, chatId);
      console.log(c.success('Telegram configured!'));

    } else if (service === 'whatsapp') {
      const webhookUrl = args[1];

      if (!webhookUrl) {
        console.log(c.error('Missing parameter'));
        console.log(c.muted('Usage: /notify whatsapp <webhook_url>'));
        return true;
      }

      context.notifier?.configureWhatsApp(webhookUrl);
      console.log(c.success('WhatsApp configured!'));

    } else if (service === 'test') {
      console.log(c.muted('Sending test message...'));
      await context.notifier?.notify('Test from Slashbot!', 'all');

    } else {
      console.log(c.error(`Unknown service: ${service}`));
    }

    return true;
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
  execute: async (args) => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = `${process.env.HOME}/.config/slashbot/history`;
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
        console.log(`  ${c.muted('Compression:')}  ${enabled ? c.success('Enabled') : c.warning('Disabled')}`);
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
  execute: async () => {
    console.log(c.violet('\nGoodbye!\n'));
    process.exit(0);
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

export async function executeCommand(
  parsed: ParsedCommand,
  context: CommandContext
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
