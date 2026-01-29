/**
 * Code Editor Module for Slashbot
 * Allows AI to search and edit code files
 */

import { c, colors, fileViewer } from '../ui/colors';
import * as path from 'path';
import type { EditResult, EditStatus } from '../actions/types';

const CONFIG_FILE = '.slashbot';

export interface ProjectConfig {
  authorized: boolean;
  authorizedAt?: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

export interface FileEdit {
  path: string;
  search: string;
  replace: string;
}

export class CodeEditor {
  private workDir: string;
  private config: ProjectConfig | null = null;

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir;
  }

  async init(): Promise<void> {
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const configPath = path.join(this.workDir, CONFIG_FILE);
      const file = Bun.file(configPath);
      if (await file.exists()) {
        this.config = await file.json();
      }
    } catch {
      this.config = null;
    }
  }

  async isAuthorized(): Promise<boolean> {
    await this.loadConfig();
    return this.config?.authorized === true;
  }

  async authorize(): Promise<void> {
    this.config = {
      authorized: true,
      authorizedAt: new Date().toISOString(),
      allowedPaths: ['**/*'],
      deniedPaths: ['node_modules/**', '.git/**', '*.lock', '*.log'],
    };

    const configPath = path.join(this.workDir, CONFIG_FILE);
    await Bun.write(configPath, JSON.stringify(this.config, null, 2));
    console.log(c.success(`Authorization granted for ${this.workDir}`));
    console.log(c.muted(`Config: ${configPath}`));
  }

  async revoke(): Promise<void> {
    const configPath = path.join(this.workDir, CONFIG_FILE);
    try {
      const { unlink } = await import('fs/promises');
      await unlink(configPath);
    } catch {
      // File might not exist
    }
    this.config = null;
    console.log(c.success('Authorization revoked'));
  }

  async grep(pattern: string, filePattern?: string): Promise<SearchResult[]> {
    if (!await this.isAuthorized()) {
      console.log(c.error('Not authorized. Use /auth to authorize.'));
      return [];
    }

    const results: SearchResult[] = [];

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Build grep command
      const excludes = '--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude=*.lock';
      const fileArg = filePattern ? `--include="${filePattern}"` : '';
      const cmd = `grep -rn ${excludes} ${fileArg} "${pattern}" ${this.workDir} 2>/dev/null | head -50`;

      const { stdout } = await execAsync(cmd);

      for (const line of stdout.split('\n').filter(l => l.trim())) {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          results.push({
            file: match[1].replace(this.workDir + '/', ''),
            line: parseInt(match[2]),
            content: match[3].trim(),
            match: pattern,
          });
        }
      }
    } catch {
      // No results or grep error
    }

    return results;
  }

  async readFile(filePath: string): Promise<string | null> {
    if (!await this.isAuthorized()) {
      console.log(c.error('Not authorized'));
      return null;
    }

    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);
      const file = Bun.file(fullPath);
      return await file.text();
    } catch {
      return null;
    }
  }

  async editFile(edit: FileEdit): Promise<EditResult> {
    if (!await this.isAuthorized()) {
      console.log(c.error('Not authorized'));
      return { success: false, status: 'error', message: 'Not authorized' };
    }

    try {
      const fullPath = path.isAbsolute(edit.path) ? edit.path : path.join(this.workDir, edit.path);
      const file = Bun.file(fullPath);

      if (!await file.exists()) {
        console.log(c.error(`File not found: ${edit.path}`));
        return { success: false, status: 'not_found', message: `File not found: ${edit.path}` };
      }

      const content = await file.text();

      if (!content.includes(edit.search)) {
        console.log(c.error(`Pattern not found in ${edit.path}`));
        console.log(c.muted(`Searching: "${edit.search.slice(0, 50)}..."`));
        return { success: false, status: 'not_found', message: `Pattern not found in ${edit.path}` };
      }

      // Count occurrences for uniqueness warning
      const occurrences = content.split(edit.search).length - 1;
      if (occurrences > 1) {
        console.log(c.warning(`Warning: Pattern found ${occurrences} times, only first will be replaced`));
      }

      // Idempotency check - is this edit already applied?
      const newContent = content.replace(edit.search, edit.replace);
      if (newContent === content) {
        console.log(c.muted(`Edit already applied: ${edit.path}`));
        return { success: true, status: 'already_applied', message: 'Edit already applied (no change needed)' };
      }

      await Bun.write(fullPath, newContent);

      // Display the diff with Claude Code style viewer
      fileViewer.displayInlineEdit(edit.path, edit.search, edit.replace);
      console.log(c.success(`Modified: ${edit.path}`));
      return { success: true, status: 'applied', message: `Modified: ${edit.path}` };
    } catch (error) {
      console.log(c.error(`Edit error: ${error}`));
      return { success: false, status: 'error', message: `Edit error: ${error}` };
    }
  }

  async createFile(filePath: string, content: string): Promise<boolean> {
    if (!await this.isAuthorized()) {
      console.log(c.error('Not authorized'));
      return false;
    }

    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);

      // Create directory if needed
      const dir = path.dirname(fullPath);
      const { mkdir } = await import('fs/promises');
      await mkdir(dir, { recursive: true });

      await Bun.write(fullPath, content);

      // Display preview of created file
      const previewContent = content.split('\n').slice(0, 10).join('\n');
      fileViewer.displayFile(filePath, previewContent, 1, Math.min(10, content.split('\n').length));
      console.log(c.success(`Created: ${filePath}`));
      return true;
    } catch (error) {
      console.log(c.error(`Creation error: ${error}`));
      return false;
    }
  }

  async listFiles(pattern?: string): Promise<string[]> {
    if (!await this.isAuthorized()) {
      return [];
    }

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const excludes = '-not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*"';
      const nameArg = pattern ? `-name "${pattern}"` : '-type f';
      const cmd = `find ${this.workDir} ${excludes} ${nameArg} 2>/dev/null | head -100`;

      const { stdout } = await execAsync(cmd);
      return stdout.split('\n')
        .filter(l => l.trim())
        .map(f => f.replace(this.workDir + '/', ''));
    } catch {
      return [];
    }
  }

  async getContext(files?: string[]): Promise<string> {
    const context: string[] = [];

    // List project structure
    const allFiles = await this.listFiles();
    context.push('## Fichiers du projet:\n' + allFiles.slice(0, 30).join('\n'));

    // Read specified files
    if (files) {
      for (const file of files.slice(0, 5)) {
        const content = await this.readFile(file);
        if (content) {
          context.push(`\n## ${file}:\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
        }
      }
    }

    return context.join('\n');
  }

  getWorkDir(): string {
    return this.workDir;
  }
}

export function createCodeEditor(workDir?: string): CodeEditor {
  return new CodeEditor(workDir);
}
