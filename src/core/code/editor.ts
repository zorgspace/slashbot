/**
 * Code Editor Module for Slashbot
 * Allows AI to search and edit code files
 */

import { display } from '../ui';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import type { EditResult, GrepOptions } from '../actions/types';
import { EXCLUDED_DIRS, EXCLUDED_FILES } from '../config/constants';

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

interface DiffHunk {
  startLine: number;
  lineCount: number;
  diffLines: DiffLine[];
}

export class CodeEditor {
  private workDir: string;

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir;
  }

  async init(): Promise<void> {
    // No-op, kept for compatibility
  }

  async isAuthorized(): Promise<boolean> {
    return true; // Always authorized
  }

  async grep(
    pattern: string,
    filePattern?: string,
    options?: GrepOptions,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Build grep command with options - exclude build dirs and generated files
      const dirExcludes = EXCLUDED_DIRS.map(d => `--exclude-dir=${d}`).join(' ');
      const fileExcludes = EXCLUDED_FILES.map(f => `--exclude=${f}`).join(' ');
      const excludes = `${dirExcludes} ${fileExcludes}`;
      const fileArg = filePattern ? `--include="${filePattern}"` : '';

      // Context options
      let contextArg = '';
      if (options?.context) {
        contextArg = `-C ${options.context}`;
      } else {
        if (options?.contextBefore) contextArg += `-B ${options.contextBefore} `;
        if (options?.contextAfter) contextArg += `-A ${options.contextAfter} `;
      }

      // Case insensitivity
      const caseArg = options?.caseInsensitive ? '-i' : '';

      // Determine search path - can be a specific file or directory
      let searchPath = this.workDir;
      const pathOpt = options?.path;
      if (pathOpt && typeof pathOpt === 'string') {
        searchPath = pathOpt.startsWith('/') ? pathOpt : `${this.workDir}/${pathOpt}`;
      }

      // Use -r only for directories, not files
      const fs = await import('fs');
      const isFile = fs.existsSync(searchPath) && fs.statSync(searchPath).isFile();
      const recursiveArg = isFile ? '' : '-r';

      const limit = (options as any)?.headLimit || 10;
      const cmd = `grep ${recursiveArg} -n ${caseArg} ${contextArg} ${isFile ? '' : excludes} ${fileArg} "${pattern}" "${searchPath}" 2>/dev/null | head -${limit}`;

      const { stdout } = await execAsync(cmd);

      for (const line of stdout.split('\n').filter(l => l.trim())) {
        // Handle context separator lines (--)
        if (line === '--') continue;

        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          results.push({
            file: match[1].replace(this.workDir + '/', ''),
            line: parseInt(match[2]),
            content: match[3], // Preserve indentation
            match: pattern,
          });
        }
        // Also handle context lines (file-linenum-content format)
        const contextMatch = line.match(/^(.+?)-(\d+)-(.*)$/);
        if (contextMatch) {
          results.push({
            file: contextMatch[1].replace(this.workDir + '/', ''),
            line: parseInt(contextMatch[2]),
            content: contextMatch[3], // Preserve indentation
            match: '', // Context line, not a match
          });
        }
      }
    } catch {
      // No results or grep error
    }

    return results;
  }

  async readFile(filePath: string): Promise<string | null> {
    try {
      const fullPath = this.resolvePath(filePath);
      return await fsPromises.readFile(fullPath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Resolve a file path, expanding ~ to home directory
   */
  private resolvePath(filePath: string): string {
    // Expand tilde to home directory
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    if (filePath === '~') {
      return os.homedir();
    }
    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    // Relative path - join with workDir
    return path.join(this.workDir, filePath);
  }

  /**
   * Apply a diff edit using line-based hunks
   * Hunks specify exact line numbers and unified diff content
   */
  async applyDiffEdit(filePath: string, hunks: DiffHunk[]): Promise<EditResult> {
    try {
      const fullPath = this.resolvePath(filePath);

      if (!fs.existsSync(fullPath)) {
        display.errorText(`File not found: ${filePath}`);
        return {
          success: false,
          status: 'not_found',
          path: filePath,
          message: `File not found: ${filePath}`,
        };
      }

      const content = await fsPromises.readFile(fullPath, 'utf8');
      const lines = content.split('\n');

      // Sort hunks bottom-to-top so earlier line numbers stay valid
      const sortedHunks = [...hunks].sort((a, b) => b.startLine - a.startLine);

      for (const hunk of sortedHunks) {
        const startIdx = Math.min(hunk.startLine - 1, lines.length);

        // Count original lines from context + remove entries
        const originalCount = hunk.diffLines.filter(
          l => l.type === 'context' || l.type === 'remove',
        ).length;

        // Soft verification: check removed/context lines match file
        let lineIdx = startIdx;
        for (const dl of hunk.diffLines) {
          if (dl.type === 'context' || dl.type === 'remove') {
            if (lineIdx < lines.length && lines[lineIdx].trim() !== dl.content.trim()) {
              display.warningText(
                `Line ${lineIdx + 1} mismatch: expected "${dl.content.trim().slice(0, 60)}", got "${lines[lineIdx].trim().slice(0, 60)}"`,
              );
            }
            lineIdx++;
          }
        }

        // Build replacement: context + add lines in order
        const newLines = hunk.diffLines
          .filter(l => l.type === 'context' || l.type === 'add')
          .map(l => l.content);

        lines.splice(startIdx, originalCount, ...newLines);
      }

      const newContent = lines.join('\n');

      // Idempotency check
      if (newContent === content) {
        display.muted(`Edit already applied: ${filePath}`);
        return {
          success: true,
          status: 'already_applied',
          path: filePath,
          message: 'Edit already applied',
        };
      }

      await fsPromises.writeFile(fullPath, newContent, 'utf8');
      display.successText(`Modified: ${filePath}`);
      return { success: true, status: 'applied', path: filePath, message: `Modified: ${filePath}` };
    } catch (error) {
      display.errorText(`Edit error: ${error}`);
      return {
        success: false,
        status: 'error',
        path: filePath,
        message: `Edit error: ${error}`,
      };
    }
  }

  async createFile(filePath: string, content: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);

      // Prevent creating files in .slashbot directories to avoid corrupting configuration
      const localSlashbotDir = path.join(this.workDir, '.slashbot');
      const homeSlashbotDir = path.join(os.homedir(), '.slashbot');
      if (
        fullPath.startsWith(localSlashbotDir + path.sep) ||
        fullPath.startsWith(homeSlashbotDir + path.sep) ||
        fullPath === localSlashbotDir ||
        fullPath === homeSlashbotDir
      ) {
        display.errorText(
          `Cannot create files in .slashbot directories to prevent configuration corruption`,
        );
        return false;
      }

      // Create directory if needed
      const dir = path.dirname(fullPath);
      await fsPromises.mkdir(dir, { recursive: true });

      await fsPromises.writeFile(fullPath, content, 'utf8');

      // Display preview of created file
      const previewContent = content.split('\n').slice(0, 10).join('\n');
      display.muted(
        `${filePath} (lines 1-${Math.min(10, content.split('\n').length)}):\n${previewContent}`,
      );
      display.successText(`Created: ${filePath}`);
      return true;
    } catch (error) {
      display.errorText(`Creation error: ${error}`);
      return false;
    }
  }

  async listFiles(pattern?: string): Promise<string[]> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Build find excludes from constants
      const excludes = EXCLUDED_DIRS.map(d => `-not -path "*/${d}/*"`).join(' ');
      const nameArg = pattern ? `-name "${pattern}"` : '-type f';
      const cmd = `find ${this.workDir} ${excludes} ${nameArg} 2>/dev/null | head -100`;

      const { stdout } = await execAsync(cmd);
      return stdout
        .split('\n')
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
    context.push('## Fichiers du projet:\n' + allFiles.slice(0, 50).join('\n'));

    // Read specified files (full content, no truncation)
    if (files) {
      for (const file of files.slice(0, 10)) {
        const content = await this.readFile(file);
        if (content) {
          context.push(`\n## ${file}:\n\`\`\`\n${content}\n\`\`\``);
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
