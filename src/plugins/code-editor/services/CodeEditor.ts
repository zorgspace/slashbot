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
import { EXCLUDED_DIRS, EXCLUDED_FILES, EXEC, FILE_LIMITS } from '../../../core/config/constants';
import { replace } from './replacers';
import type { EventBus } from '../../../core/events/EventBus';

/**
 * Safety net: detect if content about to be written contains raw action tags.
 * This catches corruption that slipped past the parser (defense in depth).
 */
function hasActionTagCorruption(content: string): boolean {
  const patterns = [/<edit\s+path\s*=/i, /<\/edit>/i, /<end>/i, /<bash>/i, /<say>/i];
  let count = 0;
  for (const p of patterns) {
    if (p.test(content)) count++;
  }
  return count >= 3;
}

function globSegmentToRegex(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === '*') {
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(ch)) {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function fallbackMatchesGlob(filePath: string, globPattern: string): boolean {
  const normalizedPath = filePath.split(path.sep).join('/');
  const normalizedPattern = globPattern.split(path.sep).join('/');
  const segments = normalizedPattern.split('/');
  let regexSrc = '^';

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === '**') {
      regexSrc += '(?:[^/]+/)*';
      continue;
    }
    regexSrc += globSegmentToRegex(segment);
    if (i < segments.length - 1) {
      regexSrc += '/';
    }
  }

  regexSrc += '$';
  return new RegExp(regexSrc).test(normalizedPath);
}

function matchesGlob(filePath: string, globPattern: string): boolean {
  const withNativeGlob = (path as any).matchesGlob as
    | ((candidate: string, pattern: string) => boolean)
    | undefined;
  if (typeof withNativeGlob === 'function') {
    try {
      return withNativeGlob(filePath, globPattern);
    } catch {
      // Fall through to regex fallback.
    }
  }
  return fallbackMatchesGlob(filePath, globPattern);
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
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

  async glob(pattern: string, basePath?: string): Promise<string[]> {
    const searchDir = this.resolveSearchTarget(basePath);
    const normalizedPattern = this.normalizeGlobPattern(pattern);

    try {
      const stat = await fsPromises.stat(searchDir);
      if (stat.isFile()) {
        const candidate = this.normalizeResultPath(searchDir);
        const basename = path.basename(candidate);
        if (matchesGlob(candidate, normalizedPattern) || matchesGlob(basename, normalizedPattern)) {
          return [candidate];
        }
        return [];
      }
      if (!stat.isDirectory()) {
        return [];
      }
    } catch {
      return [];
    }

    const limit = FILE_LIMITS.GLOB_MAX_FILES;
    const rgMatches = await this.globWithRipgrep(normalizedPattern, searchDir);
    if (rgMatches !== null) {
      return rgMatches.slice(0, limit).sort();
    }

    const fsMatches = await this.globWithFilesystemWalk(normalizedPattern, searchDir, limit);
    return fsMatches.slice(0, limit).sort();
  }

  async grep(
    pattern: string,
    filePattern?: string,
    options?: GrepOptions,
  ): Promise<SearchResult[]> {
    const searchPath = this.resolveSearchTarget(
      typeof options?.path === 'string' ? options.path : undefined,
    );
    const exists = await this.pathExists(searchPath);
    if (!exists) {
      return [];
    }

    const hasLineNumbers = options?.lineNumbers !== false;
    const rawGlobPattern =
      typeof options?.glob === 'string' && options.glob.trim() ? options.glob : filePattern;
    const globPattern = rawGlobPattern ? this.normalizeGlobPattern(rawGlobPattern) : undefined;
    const limit = options?.headLimit || FILE_LIMITS.GREP_MAX_LINES;

    const rgResults = await this.grepWithRipgrep(
      pattern,
      searchPath,
      hasLineNumbers,
      globPattern,
      options,
    );
    if (rgResults !== null) {
      return rgResults.slice(0, limit);
    }

    const grepResults = await this.grepWithClassicGrep(
      pattern,
      searchPath,
      hasLineNumbers,
      globPattern,
      options,
    );
    return grepResults.slice(0, limit);
  }

  private buildIgnoreGlobArgs(): string[] {
    const args: string[] = [];
    for (const dir of EXCLUDED_DIRS) {
      args.push('--glob', `!**/${dir}/**`);
    }
    for (const filePattern of EXCLUDED_FILES) {
      args.push('--glob', `!**/${filePattern}`);
    }
    return args;
  }

  private async globWithRipgrep(pattern: string, searchDir: string): Promise<string[] | null> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const args = [
        '--files',
        '--color',
        'never',
        '--glob',
        pattern,
        ...this.buildIgnoreGlobArgs(),
        searchDir,
      ];
      const { stdout } = await execFileAsync('rg', args, {
        cwd: this.workDir,
        maxBuffer: EXEC.MAX_BUFFER,
      });
      let matches = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(file => this.normalizeResultPath(file));
      if (matches.length === 0 && pattern.startsWith('**/')) {
        const retryArgs = [
          '--files',
          '--color',
          'never',
          '--glob',
          pattern.slice(3),
          ...this.buildIgnoreGlobArgs(),
          searchDir,
        ];
        const retry = await execFileAsync('rg', retryArgs, {
          cwd: this.workDir,
          maxBuffer: EXEC.MAX_BUFFER,
        });
        matches = retry.stdout
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(file => this.normalizeResultPath(file));
      }
      return [...new Set(matches)];
    } catch (error: any) {
      if (error?.code === 1) {
        return [];
      }
      if (error?.code === 'ENOENT') {
        return null;
      }
      return [];
    }
  }

  private async globWithFilesystemWalk(
    pattern: string,
    searchDir: string,
    limit: number,
  ): Promise<string[]> {
    const matches: string[] = [];
    const stack = [searchDir];

    while (stack.length > 0 && matches.length < limit) {
      const currentDir = stack.pop() as string;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (matches.length >= limit) break;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.includes(entry.name)) continue;
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (this.isExcludedFileName(entry.name)) continue;

        const relativeToSearch = path.relative(searchDir, fullPath).split(path.sep).join('/');
        if (!matchesGlob(relativeToSearch, pattern)) continue;

        matches.push(this.normalizeResultPath(fullPath));
      }
    }

    return matches;
  }

  private async grepWithRipgrep(
    pattern: string,
    searchPath: string,
    hasLineNumbers: boolean,
    globPattern: string | undefined,
    options?: GrepOptions,
  ): Promise<SearchResult[] | null> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      const args: string[] = ['--no-heading', '--color', 'never'];
      if (hasLineNumbers) args.push('--line-number');
      if (options?.caseInsensitive) args.push('-i');
      if (options?.multiline) args.push('-U');

      if (typeof options?.context === 'number') {
        args.push('-C', String(options.context));
      } else {
        if (typeof options?.contextBefore === 'number') {
          args.push('-B', String(options.contextBefore));
        }
        if (typeof options?.contextAfter === 'number') {
          args.push('-A', String(options.contextAfter));
        }
      }

      if (globPattern) {
        args.push('--glob', globPattern);
      }
      args.push(...this.buildIgnoreGlobArgs());
      args.push('--', pattern, searchPath);

      const { stdout } = await execFileAsync('rg', args, {
        cwd: this.workDir,
        maxBuffer: EXEC.MAX_BUFFER,
      });
      return this.parseGrepOutput(stdout, pattern, hasLineNumbers);
    } catch (error: any) {
      if (error?.code === 1) {
        return [];
      }
      if (error?.code === 'ENOENT') {
        return null;
      }
      return [];
    }
  }

  private async grepWithClassicGrep(
    pattern: string,
    searchPath: string,
    hasLineNumbers: boolean,
    globPattern: string | undefined,
    options?: GrepOptions,
  ): Promise<SearchResult[]> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const isFile = fs.existsSync(searchPath) && fs.statSync(searchPath).isFile();

      const args: string[] = [];
      if (!isFile) args.push('-r');
      if (hasLineNumbers) args.push('-n');
      if (options?.caseInsensitive) args.push('-i');
      if (options?.multiline) args.push('-U');

      if (typeof options?.context === 'number') {
        args.push('-C', String(options.context));
      } else {
        if (typeof options?.contextBefore === 'number') {
          args.push('-B', String(options.contextBefore));
        }
        if (typeof options?.contextAfter === 'number') {
          args.push('-A', String(options.contextAfter));
        }
      }

      if (!isFile) {
        for (const dir of EXCLUDED_DIRS) {
          args.push(`--exclude-dir=${dir}`);
        }
      }
      for (const fileExclude of EXCLUDED_FILES) {
        args.push(`--exclude=${fileExclude}`);
      }
      if (globPattern) {
        args.push(`--include=${globPattern}`);
      }

      args.push(pattern, searchPath);
      const { stdout } = await execFileAsync('grep', args, {
        cwd: this.workDir,
        maxBuffer: EXEC.MAX_BUFFER,
      });
      return this.parseGrepOutput(stdout, pattern, hasLineNumbers);
    } catch (error: any) {
      if (error?.code === 1 || error?.code === 'ENOENT') {
        return [];
      }
      return [];
    }
  }

  private parseGrepOutput(
    output: string,
    pattern: string,
    hasLineNumbers: boolean,
  ): SearchResult[] {
    const results: SearchResult[] = [];
    for (const line of output.split('\n').filter(Boolean)) {
      if (line === '--') continue;

      if (hasLineNumbers) {
        const matchLine = line.match(/^(.+?):(\d+):(.*)$/);
        if (matchLine) {
          results.push({
            file: this.normalizeResultPath(matchLine[1]),
            line: parseInt(matchLine[2], 10),
            content: matchLine[3],
            match: pattern,
          });
          continue;
        }

        const contextLine = line.match(/^(.+?)-(\d+)-(.*)$/);
        if (contextLine) {
          results.push({
            file: this.normalizeResultPath(contextLine[1]),
            line: parseInt(contextLine[2], 10),
            content: contextLine[3],
            match: '',
          });
        }
        continue;
      }

      const matchLine = line.match(/^(.+?):(.*)$/);
      if (matchLine) {
        results.push({
          file: this.normalizeResultPath(matchLine[1]),
          line: 0,
          content: matchLine[2],
          match: pattern,
        });
      }
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
    const normalizedPath = this.normalizeInputPath(filePath);
    // Expand tilde to home directory
    if (normalizedPath.startsWith('~/')) {
      return path.join(os.homedir(), normalizedPath.slice(2));
    }
    if (normalizedPath === '~') {
      return os.homedir();
    }
    // Handle absolute paths
    if (path.isAbsolute(normalizedPath)) {
      return normalizedPath;
    }
    // Relative path - join with workDir
    return path.join(this.workDir, normalizedPath);
  }

  private resolveSearchTarget(searchPath?: string): string {
    if (!searchPath || !searchPath.trim()) {
      return this.workDir;
    }
    return this.resolvePath(searchPath);
  }

  private normalizeResultPath(foundPath: string): string {
    const normalized = path.normalize(foundPath);
    const workDirNormalized = path.normalize(this.workDir);
    const workDirPrefix = `${workDirNormalized}${path.sep}`;
    if (normalized === workDirNormalized) {
      return '.';
    }
    if (normalized.startsWith(workDirPrefix)) {
      return normalized.slice(workDirPrefix.length).split(path.sep).join('/');
    }
    return normalized.split(path.sep).join('/');
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fsPromises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private isExcludedFileName(fileName: string): boolean {
    return EXCLUDED_FILES.some(pattern => matchesGlob(fileName, pattern));
  }

  private normalizeInputPath(value: string): string {
    let normalized = value.trim();
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    ) {
      normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
  }

  private normalizeGlobPattern(pattern: string): string {
    let normalized = this.normalizeInputPath(pattern).replace(/\\/g, '/');
    if (!normalized) {
      return '**/*';
    }
    if (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }
    return normalized;
  }

  /**
   * Apply a single search/replace edit using the cascading replacer system.
   */
  async applyEdit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
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

      // Safety net: reject newString corrupted with raw action tags
      if (hasActionTagCorruption(newString)) {
        display.errorText(
          `Blocked corrupted edit to ${filePath}: content contains raw action tags`,
        );
        return {
          success: false,
          status: 'error',
          path: filePath,
          message: `Edit rejected: newString for ${filePath} is corrupted with raw action tags. The LLM malfunctioned — retry the edit.`,
        };
      }

      // Apply replacement using cascading replacer system
      let newContent: string;
      try {
        newContent = replace(currentContent, oldString, newString, replaceAll);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('not found')) {
          return {
            success: false,
            status: 'no_match',
            path: filePath,
            message: `${filePath}: ${msg}`,
          };
        }
        return {
          success: false,
          status: 'error',
          path: filePath,
          message: `${filePath}: ${msg}`,
        };
      }

      // Idempotency check
      if (newContent === currentContent) {
        display.muted(`Edit already applied: ${filePath}`);
        return {
          success: true,
          status: 'already_applied',
          path: filePath,
          message: 'Edit already applied',
        };
      }

      await fsPromises.writeFile(fullPath, newContent, 'utf8');
      this.snapshots.set(fullPath, newContent);
      this.emitEditApplied(filePath, currentContent, newContent);
      return {
        success: true,
        status: 'applied',
        path: filePath,
        message: `Updated`,
        beforeContent: currentContent,
        afterContent: newContent,
      };
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

  private emitEditApplied(filePath: string, beforeContent: string, afterContent: string): void {
    this.eventBus?.emit({ type: 'edit:applied', filePath, beforeContent, afterContent });
  }

  async createFile(filePath: string, content: string): Promise<boolean> {
    // Safety net: reject content corrupted with raw action tags
    if (hasActionTagCorruption(content)) {
      display.errorText(
        `Blocked corrupted create for ${filePath}: content contains raw action tags`,
      );
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
