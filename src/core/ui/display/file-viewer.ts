/**
 * File Viewer - Claude Code style file display with line numbers and diff highlighting
 */

import { colors } from '../core';

export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'unchanged' | 'added' | 'removed' | 'context';
}

export class FileViewer {
  private maxLineWidth: number;

  constructor() {
    this.maxLineWidth = Math.min(process.stdout.columns || 80, 100) - 10;
  }

  /**
   * Format a line number with padding
   */
  private formatLineNumber(num: number, maxNum: number): string {
    const padding = String(maxNum).length;
    return String(num).padStart(padding, ' ');
  }

  /**
   * Display file content with line numbers
   */
  displayFile(filePath: string, content: string, startLine = 1, endLine?: number): void {
    const lines = content.split('\n');
    const maxLine = endLine || lines.length;
    const displayLines = lines.slice(startLine - 1, endLine);

    // Header
    console.log(`${colors.muted}╭─ ${filePath}${colors.reset}`);

    displayLines.forEach((line, i) => {
      const lineNum = startLine + i;
      const numStr = this.formatLineNumber(lineNum, maxLine);
      const truncatedLine =
        line.length > this.maxLineWidth ? line.slice(0, this.maxLineWidth - 3) + '...' : line;
      console.log(
        `${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset} ${colors.white}${truncatedLine}${colors.reset}`,
      );
    });

    console.log(`${colors.muted}╰─${colors.reset}`);
  }

  /**
   * Display a diff between old and new content with colored backgrounds
   */
  displayDiff(filePath: string, oldContent: string, newContent: string): void {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines = this.computeDiff(oldLines, newLines);

    if (diffLines.length === 0) {
      console.log(`${colors.muted}No changes${colors.reset}`);
      return;
    }

    const maxLineNum = Math.max(...diffLines.map(d => d.lineNumber));

    // Header
    console.log(`${colors.muted}╭─ ${filePath}${colors.reset}`);

    for (const diff of diffLines) {
      const numStr = this.formatLineNumber(diff.lineNumber, maxLineNum);
      const truncatedContent =
        diff.content.length > this.maxLineWidth
          ? diff.content.slice(0, this.maxLineWidth - 3) + '...'
          : diff.content;

      // Pad the line to fill the width for background color
      const paddedContent = truncatedContent.padEnd(this.maxLineWidth, ' ');

      switch (diff.type) {
        case 'removed':
          console.log(
            `${colors.muted}│${colors.reset} ${colors.error}${numStr}${colors.reset} ${colors.bgRed}${colors.white}- ${paddedContent}${colors.reset}`,
          );
          break;
        case 'added':
          console.log(
            `${colors.muted}│${colors.reset} ${colors.success}${numStr}${colors.reset} ${colors.bgGreen}${colors.white}+ ${paddedContent}${colors.reset}`,
          );
          break;
        case 'context':
          console.log(
            `${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset}   ${colors.muted}${truncatedContent}${colors.reset}`,
          );
          break;
        default:
          console.log(
            `${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset}   ${colors.white}${truncatedContent}${colors.reset}`,
          );
      }
    }

    console.log(`${colors.muted}╰─${colors.reset}`);
  }

  /**
   * Simple diff computation - find removed and added lines
   */
  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const result: DiffLine[] = [];
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let oldIdx = 0;
    let newIdx = 0;
    let lineNum = 1;

    // Find the first difference
    while (
      oldIdx < oldLines.length &&
      newIdx < newLines.length &&
      oldLines[oldIdx] === newLines[newIdx]
    ) {
      oldIdx++;
      newIdx++;
      lineNum++;
    }

    // Add context before (up to 3 lines)
    const contextStart = Math.max(0, oldIdx - 3);
    for (let i = contextStart; i < oldIdx; i++) {
      result.push({
        lineNumber: i + 1,
        content: oldLines[i],
        type: 'context',
      });
    }

    // Find removed lines
    const removedStart = oldIdx;
    while (oldIdx < oldLines.length && !newSet.has(oldLines[oldIdx])) {
      result.push({
        lineNumber: oldIdx + 1,
        content: oldLines[oldIdx],
        type: 'removed',
      });
      oldIdx++;
    }

    // Find added lines
    while (newIdx < newLines.length && !oldSet.has(newLines[newIdx])) {
      result.push({
        lineNumber: newIdx + 1,
        content: newLines[newIdx],
        type: 'added',
      });
      newIdx++;
    }

    // Add context after (up to 3 lines)
    const contextEnd = Math.min(newLines.length, newIdx + 3);
    for (let i = newIdx; i < contextEnd; i++) {
      result.push({
        lineNumber: i + 1,
        content: newLines[i],
        type: 'context',
      });
    }

    return result;
  }

  /**
   * Display inline edit preview (old -> new)
   */
  displayInlineEdit(filePath: string, oldText: string, newText: string, context?: string): void {
    console.log(`${colors.muted}╭─ Edit: ${filePath}${colors.reset}`);

    // Show context if provided
    if (context) {
      const contextLines = context.split('\n').slice(0, 2);
      contextLines.forEach(line => {
        const truncated = line.slice(0, this.maxLineWidth);
        console.log(`${colors.muted}│   ${truncated}${colors.reset}`);
      });
    }

    // Show removed lines
    const oldLines = oldText.split('\n');
    oldLines.forEach(line => {
      const truncated = line.slice(0, this.maxLineWidth);
      const padded = truncated.padEnd(this.maxLineWidth, ' ');
      console.log(
        `${colors.muted}│${colors.reset} ${colors.bgRed}${colors.white}- ${padded}${colors.reset}`,
      );
    });

    // Show added lines
    const newLines = newText.split('\n');
    newLines.forEach(line => {
      const truncated = line.slice(0, this.maxLineWidth);
      const padded = truncated.padEnd(this.maxLineWidth, ' ');
      console.log(
        `${colors.muted}│${colors.reset} ${colors.bgGreen}${colors.white}+ ${padded}${colors.reset}`,
      );
    });

    console.log(`${colors.muted}╰─${colors.reset}`);
  }
}

// Global file viewer instance
export const fileViewer = new FileViewer();
