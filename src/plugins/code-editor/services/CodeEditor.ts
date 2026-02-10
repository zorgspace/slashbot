/**
 * Code Editor Module for Slashbot
 * Allows AI to search and edit code files
 */

import { display } from '../../../core/ui';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import type { EditResult, GrepOptions } from '../../../core/actions/types';
import { EXCLUDED_DIRS, EXCLUDED_FILES } from '../../../core/config/constants';
import { merge3 } from './diff3';
import { replace } from './replacers';
import type { EventBus } from '../../../core/events/EventBus';

/**
 * Safety net: detect if content about to be written contains raw action tags.
 * This catches corruption that slipped past the parser (defense in depth).
 */
function hasActionTagCorruption(content: string): boolean {
  const patterns = [
    /<edit\s+path\s*=/i,
    /<\/edit>/i,
    /<end>/i,
    /<bash>/i,
    /<say>/i,
  ];
  let count = 0;
  for (const p of patterns) {
    if (p.test(content)) count++;
  }
  return count >= 3;
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export class CodeEditor {
  private workDir: string;
  /** Snapshots stored at read time: path → content */
  private snapshots: Map<string, string> = new Map();
  private eventBus?: EventBus;

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  async init(): Promise<void> {
    // No-op, kept for compatibility
  }

  async isAuthorized(): Promise<boolean> {
    return true; // Always authorized
  }

  /**
   * Store a snapshot of file content (called after every read).
   */
  storeSnapshot(filePath: string, content: string): void {
    const key = this.resolvePath(filePath);
    this.snapshots.set(key, content);
  }

  /**
   * Retrieve stored snapshot for a file.
   */
  getSnapshot(filePath: string): string | undefined {
    const key = this.resolvePath(filePath);
    return this.snapshots.get(key);
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
      const content = await fsPromises.readFile(fullPath, 'utf8');
      // Store snapshot on every read
      this.snapshots.set(fullPath, content);
      return content;
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
   * Apply a merge-based edit. Supports two modes:
   *
   * - 'full': LLM provides the complete intended file content.
   *   Uses diff3 merge if the file changed since read.
   *
   * - 'search-replace': LLM provides search/replace blocks.
   *   Finds each search block in the file and replaces it.
   */
  async applyMergeEdit(
    filePath: string,
    mode: 'full' | 'search-replace',
    content?: string,
    blocks?: SearchReplaceBlock[],
  ): Promise<EditResult> {
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

      const currentContent = await fsPromises.readFile(fullPath, 'utf8');

      if (mode === 'full') {
        return await this.applyFullEdit(filePath, fullPath, currentContent, content || '');
      } else {
        return await this.applySearchReplaceEdit(filePath, fullPath, currentContent, blocks || []);
      }
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

  /**
   * Full-file edit: diff3 merge between snapshot, current disk, and LLM output.
   */
  private async applyFullEdit(
    filePath: string,
    fullPath: string,
    currentContent: string,
    newContent: string,
  ): Promise<EditResult> {
    // Safety net: reject content corrupted with raw action tags
    if (hasActionTagCorruption(newContent)) {
      display.errorText(`Blocked corrupted write to ${filePath}: content contains raw action tags`);
      return {
        success: false,
        status: 'error',
        path: filePath,
        message: `Edit rejected: content for ${filePath} is corrupted with raw action tags (nested <edit>/<end>/<bash>/<say> detected). The LLM malfunctioned — retry the edit.`,
      };
    }

    // Idempotency: if new content matches current, nothing to do
    if (newContent === currentContent) {
      display.muted(`Edit already applied: ${filePath}`);
      return {
        success: true,
        status: 'already_applied',
        path: filePath,
        message: 'Edit already applied',
      };
    }

    const snapshot = this.snapshots.get(fullPath);

    // Fast path: no snapshot (file was never read) or snapshot matches current disk
    if (!snapshot || snapshot === currentContent) {
      await fsPromises.writeFile(fullPath, newContent, 'utf8');
      // Update snapshot to new content
      this.snapshots.set(fullPath, newContent);
      this.emitEditApplied(filePath, currentContent, newContent);
      display.successText(`Modified: ${filePath}`);
      return {
        success: true,
        status: 'applied',
        path: filePath,
        message: `Modified: ${filePath}`,
      };
    }

    // Merge path: file changed since read — three-way merge
    const baseLines = snapshot.split('\n');
    const oursLines = currentContent.split('\n');
    const theirsLines = newContent.split('\n');

    const result = merge3(baseLines, oursLines, theirsLines);

    if (result.success) {
      const mergedContent = result.merged.join('\n');

      if (mergedContent === currentContent) {
        display.muted(`Edit already applied: ${filePath}`);
        return {
          success: true,
          status: 'already_applied',
          path: filePath,
          message: 'Edit already applied',
        };
      }

      await fsPromises.writeFile(fullPath, mergedContent, 'utf8');
      this.snapshots.set(fullPath, mergedContent);
      this.emitEditApplied(filePath, currentContent, mergedContent);
      display.warningText(`Merged (file changed since read): ${filePath}`);
      return {
        success: true,
        status: 'applied',
        path: filePath,
        message: `Merged: ${filePath} (${result.conflictCount} conflicts resolved)`,
      };
    }

    // Conflict path: apply with conflicts (favor LLM intent) but report
    const mergedContent = result.merged.join('\n');
    await fsPromises.writeFile(fullPath, mergedContent, 'utf8');
    this.snapshots.set(fullPath, mergedContent);
    this.emitEditApplied(filePath, currentContent, mergedContent);
    display.warningText(`Applied with ${result.conflictCount} conflict(s): ${filePath}`);
    return {
      success: true,
      status: 'conflict',
      path: filePath,
      message: `Applied with ${result.conflictCount} conflict(s) in ${filePath}. The LLM's version was used for conflicting regions.`,
      conflicts: result.conflicts,
    };
  }

  /**
   * Search/Replace edit: cascading replacer system with 9 strategies.
   */
  private async applySearchReplaceEdit(
    filePath: string,
    fullPath: string,
    currentContent: string,
    blocks: SearchReplaceBlock[],
  ): Promise<EditResult> {
    if (blocks.length === 0) {
      return {
        success: false,
        status: 'error',
        path: filePath,
        message: 'No search/replace blocks provided',
      };
    }

    let content = currentContent;

    for (const block of blocks) {
      if (typeof block.search !== 'string' || typeof block.replace !== 'string') {
        return {
          success: false,
          status: 'error',
          path: filePath,
          message: `${filePath}: Invalid search/replace block — search and replace must be strings`,
        };
      }
      const result = replace(content, block.search, block.replace);

      if (!result.ok) {
        return {
          success: false,
          status: 'no_match',
          path: filePath,
          message: `${filePath}: ${result.message}`,
        };
      }

      content = result.content;
    }

    // Idempotency check
    if (content === currentContent) {
      display.muted(`Edit already applied: ${filePath}`);
      return {
        success: true,
        status: 'already_applied',
        path: filePath,
        message: 'Edit already applied',
      };
    }

    await fsPromises.writeFile(fullPath, content, 'utf8');
    // Update snapshot
    this.snapshots.set(fullPath, content);
    this.emitEditApplied(filePath, currentContent, content);
    display.successText(`Modified: ${filePath}`);
    return {
      success: true,
      status: 'applied',
      path: filePath,
      message: `Modified: ${filePath}`,
    };
  }

  private emitEditApplied(filePath: string, beforeContent: string, afterContent: string): void {
    this.eventBus?.emit({ type: 'edit:applied', filePath, beforeContent, afterContent });
  }

  async createFile(filePath: string, content: string): Promise<boolean> {
    // Safety net: reject content corrupted with raw action tags
    if (hasActionTagCorruption(content)) {
      display.errorText(`Blocked corrupted create for ${filePath}: content contains raw action tags`);
      return false;
    }

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
