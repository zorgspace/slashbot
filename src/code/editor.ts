/**
 * Code Editor Module for Slashbot
 * Allows AI to search and edit code files
 */

import { c, colors, fileViewer } from '../ui/colors';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import type { EditResult, EditStatus, GrepOptions } from '../actions/types';
import { EXCLUDED_DIRS, EXCLUDED_FILES } from '../config/constants';

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
  replaceAll?: boolean;
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
      if (options?.path) {
        searchPath = options.path.startsWith('/')
          ? options.path
          : `${this.workDir}/${options.path}`;
      }

      // Use -r only for directories, not files
      const fs = await import('fs');
      const isFile = fs.existsSync(searchPath) && fs.statSync(searchPath).isFile();
      const recursiveArg = isFile ? '' : '-r';

      const cmd = `grep ${recursiveArg} -n ${caseArg} ${contextArg} ${isFile ? '' : excludes} ${fileArg} "${pattern}" "${searchPath}" 2>/dev/null | head -100`;

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
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);
      return await fsPromises.readFile(fullPath, 'utf8');
    } catch {
      return null;
    }
  }

  async editFile(edit: FileEdit): Promise<EditResult> {
    try {
      const fullPath = path.isAbsolute(edit.path) ? edit.path : path.join(this.workDir, edit.path);

      if (!fs.existsSync(fullPath)) {
        console.log(c.error(`File not found: ${edit.path}`));
        return { success: false, status: 'not_found', message: `File not found: ${edit.path}` };
      }

      const content = await fsPromises.readFile(fullPath, 'utf8');

      // Try exact match first
      if (content.includes(edit.search)) {
        return this.applyEdit(fullPath, content, edit);
      }

      // Try whitespace-normalized match
      const normalizedMatch = this.findNormalizedMatch(content, edit.search);
      if (normalizedMatch) {
        console.log(c.muted(`Using whitespace-normalized match`));
        return this.applyEdit(fullPath, content, {
          ...edit,
          search: normalizedMatch,
        });
      }

      // Pattern not found - provide helpful suggestions
      console.log(c.warning(`Pattern not found in ${edit.path}`));
      const suggestions = this.findSimilarPatterns(content, edit.search);

      if (suggestions.length > 0) {
        console.log(c.muted(`Did you mean one of these?`));
        suggestions.forEach((s, i) => {
          const preview = s.length > 80 ? s.slice(0, 77) + '...' : s;
          console.log(c.muted(`  ${i + 1}. "${preview.replace(/\n/g, '\\n')}"`));
        });
      }

      return {
        success: false,
        status: 'not_found',
        message: `Pattern not found in ${edit.path}. ${suggestions.length > 0 ? 'Similar patterns exist - check whitespace/indentation.' : 'Use <read> to see actual content.'}`,
      };
    } catch (error) {
      console.log(c.error(`Edit error: ${error}`));
      return { success: false, status: 'error', message: `Edit error: ${error}` };
    }
  }

  private async applyEdit(fullPath: string, content: string, edit: FileEdit): Promise<EditResult> {
    const occurrences = content.split(edit.search).length - 1;

    // Apply replacement
    let newContent: string;
    if (edit.replaceAll && occurrences > 1) {
      newContent = content.split(edit.search).join(edit.replace);
      console.log(c.muted(`Replacing all ${occurrences} occurrences`));
    } else {
      if (occurrences > 1 && !edit.replaceAll) {
        console.log(
          c.warning(
            `Pattern found ${occurrences} times, replacing first only. Use replaceAll="true" for all.`,
          ),
        );
      }
      newContent = content.replace(edit.search, edit.replace);
    }

    // Idempotency check
    if (newContent === content) {
      console.log(c.muted(`Edit already applied: ${edit.path}`));
      return {
        success: true,
        status: 'already_applied',
        message: 'Edit already applied (no change needed)',
      };
    }

    await fsPromises.writeFile(fullPath, newContent, 'utf8');

    console.log(c.success(`Modified: ${edit.path}${edit.replaceAll && occurrences > 1 ? `` : ''}`));
    return { success: true, status: 'applied', message: `Modified: ${edit.path}` };
  }


  /**
   * Try to find the search pattern with normalized whitespace
   * Uses multiple strategies to find a match
   */
  private findNormalizedMatch(content: string, search: string): string | null {
    // Strategy 1: Normalize only line endings and trailing whitespace (preserve leading indentation)
    const normalizeLight = (s: string) =>
      s
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/[ \t]+$/gm, ''); // Trim trailing whitespace per line only

    const lightSearch = normalizeLight(search);
    const lightContent = normalizeLight(content);

    if (lightContent.includes(lightSearch)) {
      const idx = lightContent.indexOf(lightSearch);
      return content.substring(idx, idx + lightSearch.length);
    }

    // Strategy 2: Line-by-line matching with flexible indentation
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');

    // Find first non-empty search line
    const firstNonEmptyIdx = searchLines.findIndex(l => l.trim().length > 0);
    if (firstNonEmptyIdx === -1) return null;

    const firstSearchLine = searchLines[firstNonEmptyIdx].trim();

    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() === firstSearchLine) {
        // Try to match all search lines from this position
        let searchIdx = firstNonEmptyIdx;
        let contentIdx = i;
        let allMatch = true;
        const matchedLines: number[] = [];

        while (searchIdx < searchLines.length && contentIdx < contentLines.length) {
          const searchTrimmed = searchLines[searchIdx].trim();
          const contentTrimmed = contentLines[contentIdx].trim();

          // Handle empty lines
          if (searchTrimmed === '' && contentTrimmed === '') {
            matchedLines.push(contentIdx);
            searchIdx++;
            contentIdx++;
            continue;
          }
          if (searchTrimmed === '') {
            searchIdx++;
            continue;
          }
          if (contentTrimmed === '') {
            contentIdx++;
            continue;
          }

          // Compare trimmed content
          if (contentTrimmed === searchTrimmed) {
            matchedLines.push(contentIdx);
            searchIdx++;
            contentIdx++;
          } else {
            allMatch = false;
            break;
          }
        }

        // Check if we matched all search lines
        if (allMatch && searchIdx >= searchLines.length) {
          const startLine = matchedLines[0];
          const endLine = matchedLines[matchedLines.length - 1];
          return contentLines.slice(startLine, endLine + 1).join('\n');
        }
      }
    }

    // Strategy 3: Strict line-by-line matching - require exact trimmed match for ALL lines
    // This is safer than fuzzy matching which can corrupt files
    const searchTrimmedLines = searchLines.map(l => l.trim()).filter(l => l.length > 0);

    if (searchTrimmedLines.length === 0) return null;

    // Find first line that matches exactly (trimmed)
    const firstTrimmedLine = searchTrimmedLines[0];

    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() !== firstTrimmedLine) continue;

      // Found potential start, verify ALL remaining lines match exactly
      let allMatch = true;
      let searchIdx = 1;
      let contentIdx = i + 1;
      const matchStart = i;

      while (searchIdx < searchTrimmedLines.length && contentIdx < contentLines.length) {
        const searchLine = searchTrimmedLines[searchIdx];
        const contentLine = contentLines[contentIdx].trim();

        // Skip empty lines in content
        if (contentLine === '') {
          contentIdx++;
          continue;
        }

        if (contentLine !== searchLine) {
          allMatch = false;
          break;
        }

        searchIdx++;
        contentIdx++;
      }

      // All search lines must be matched
      if (allMatch && searchIdx === searchTrimmedLines.length) {
        const result = contentLines.slice(matchStart, contentIdx).join('\n');
        console.log(c.muted(`Matched by line-by-line comparison (lines ${matchStart + 1}-${contentIdx})`));
        return result;
      }
    }

    return null;
  }

  /**
   * Extract the original text from content given a match in normalized content
   */
  private extractOriginalMatch(
    original: string,
    normalized: string,
    normalizedIdx: number,
    normalizedLen: number,
  ): string | null {
    // This is approximate - find the region in original that corresponds
    // to the normalized match by tracking character counts
    const origLines = original.split('\n');
    const normLines = normalized.split('\n');

    let normCharCount = 0;
    let startLine = 0;

    // Find start line
    for (let i = 0; i < normLines.length; i++) {
      if (normCharCount + normLines[i].length >= normalizedIdx) {
        startLine = i;
        break;
      }
      normCharCount += normLines[i].length + 1; // +1 for newline
    }

    // Find end line
    const endCharIdx = normalizedIdx + normalizedLen;
    let endLine = startLine;
    for (let i = startLine; i < normLines.length; i++) {
      normCharCount += normLines[i].length + 1;
      endLine = i;
      if (normCharCount >= endCharIdx) break;
    }

    // Extract from original
    return origLines.slice(startLine, endLine + 1).join('\n');
  }

  /**
   * Try to match search lines starting from a given content line
   */
  private tryMatchFromLine(
    contentLines: string[],
    startIdx: number,
    searchLines: string[],
  ): string | null {
    let contentIdx = startIdx;
    let searchIdx = 0;
    const matchedContentLines: number[] = [];

    while (searchIdx < searchLines.length && contentIdx < contentLines.length) {
      const searchTrimmed = searchLines[searchIdx];
      const contentTrimmed = contentLines[contentIdx].trim();

      // Skip empty lines in both
      if (!contentTrimmed && !searchTrimmed) {
        contentIdx++;
        searchIdx++;
        continue;
      }
      if (!contentTrimmed) {
        contentIdx++;
        continue;
      }
      if (!searchTrimmed) {
        searchIdx++;
        continue;
      }

      // Check for match (exact or contained)
      if (contentTrimmed === searchTrimmed || contentTrimmed.includes(searchTrimmed)) {
        matchedContentLines.push(contentIdx);
        searchIdx++;
      }
      contentIdx++;

      // Don't look too far ahead
      if (contentIdx - startIdx > searchLines.length * 2) break;
    }

    if (searchIdx === searchLines.length && matchedContentLines.length > 0) {
      const firstMatch = matchedContentLines[0];
      const lastMatch = matchedContentLines[matchedContentLines.length - 1];
      return contentLines.slice(firstMatch, lastMatch + 1).join('\n');
    }

    return null;
  }

  /**
   * Find similar patterns to help debug failed matches
   */
  private findSimilarPatterns(content: string, search: string): string[] {
    const suggestions: string[] = [];
    const lines = content.split('\n');
    const searchLines = search.split('\n');
    const firstSearchLine = searchLines[0].trim();

    if (!firstSearchLine || firstSearchLine.length < 5) return suggestions;

    // Find lines that contain significant parts of the first search line
    const keywords = firstSearchLine.split(/\s+/).filter(w => w.length > 3);

    for (let i = 0; i < lines.length && suggestions.length < 3; i++) {
      const line = lines[i];
      const matchedKeywords = keywords.filter(kw => line.includes(kw));

      if (matchedKeywords.length >= Math.ceil(keywords.length * 0.5)) {
        // Found a similar line - get context
        const contextStart = i;
        const contextEnd = Math.min(i + searchLines.length, lines.length);
        const context = lines.slice(contextStart, contextEnd).join('\n');

        if (!suggestions.includes(context)) {
          suggestions.push(context);
        }
      }
    }

    return suggestions;
  }

  /**
   * Apply multiple edits atomically - all succeed or none applied
   */
  async multiEditFile(
    filePath: string,
    edits: Array<{ search: string; replace: string; replaceAll?: boolean }>,
  ): Promise<EditResult> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);

      if (!fs.existsSync(fullPath)) {
        return { success: false, status: 'not_found', message: `File not found: ${filePath}` };
      }

      let content = await fsPromises.readFile(fullPath, 'utf8');
      const originalContent = content;
      const appliedEdits: string[] = [];

      // Validate all edits first (dry run)
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (!content.includes(edit.search)) {
          // Try normalized match
          const normalized = this.findNormalizedMatch(content, edit.search);
          if (!normalized) {
            return {
              success: false,
              status: 'not_found',
              message: `Edit ${i + 1}/${edits.length} failed: pattern not found. Aborting all edits.`,
            };
          }
          // Update the edit with normalized search for actual application
          edits[i] = { ...edit, search: normalized };
        }
      }

      // Apply all edits
      for (const edit of edits) {
        if (edit.replaceAll) {
          content = content.split(edit.search).join(edit.replace);
        } else {
          content = content.replace(edit.search, edit.replace);
        }
        appliedEdits.push(edit.search.split('\n')[0].slice(0, 30));
      }

      // Check if anything changed
      if (content === originalContent) {
        return {
          success: true,
          status: 'already_applied',
          message: 'All edits already applied',
        };
      }

      await fsPromises.writeFile(fullPath, content, 'utf8');
      console.log(c.success(`Applied ${edits.length} edits to ${filePath}`));

      return {
        success: true,
        status: 'applied',
        message: `Applied ${edits.length} edits to ${filePath}`,
      };
    } catch (error) {
      return { success: false, status: 'error', message: `Multi-edit error: ${error}` };
    }
  }

  async createFile(filePath: string, content: string): Promise<boolean> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);

      // Create directory if needed
      const dir = path.dirname(fullPath);
      await fsPromises.mkdir(dir, { recursive: true });

      await fsPromises.writeFile(fullPath, content, 'utf8');

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
