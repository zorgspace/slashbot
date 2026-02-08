/**
 * DiffPanel - Right-side scrollable panel displaying unified diffs for edited files
 *
 * Auto-shows when edits happen, toggle with Ctrl+D.
 * Accumulates diffs across the session. Cleared on /clear.
 * Uses OpenTUI DiffRenderable for proper diff rendering.
 */

import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  DiffRenderable,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../theme';
import { diffLines } from '../../code/diff3';
import { basename } from 'path';

const MAX_DIFF_LINES = 300;
const MAX_ENTRIES = 50;

export class DiffPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private _visible = false;
  private entryCount = 0;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'diff-container',
      width: 0,
      flexDirection: 'column',
      visible: false,
      flexShrink: 0,
    });

    const titleBar = new BoxRenderable(renderer, {
      id: 'diff-titlebar',
      height: 1,
      paddingLeft: 1,
      flexDirection: 'row',
    });

    const title = new TextRenderable(renderer, {
      id: 'diff-title',
      content: t`${bold(fg(theme.violetLight)('Diffs'))} ${dim(fg(theme.muted)('Ctrl+D to hide'))}`,
      height: 1,
    });

    titleBar.add(title);

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'diff-scroll',
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
      stickyScroll: true,
      stickyStart: 'bottom',
    });

    this.container.add(titleBar);
    this.container.add(this.scrollBox);
  }

  /**
   * Add a diff for an edited file using OpenTUI DiffRenderable.
   */
  addDiff(filePath: string, before: string, after: string): void {
    const unifiedDiff = this.buildUnifiedDiff(filePath, before, after);
    if (!unifiedDiff) return;

    this.entryCount++;

    // File header label
    const header = new TextRenderable(this.renderer, {
      id: `diff-header-${this.entryCount}`,
      content: t`${bold(fg(theme.violet)(filePath))}`,
    });
    this.scrollBox.add(header);

    // DiffRenderable (no syntax highlighting to avoid tree-sitter native crashes)
    const lineCount = unifiedDiff.split('\n').length;
    try {
      const diff = new DiffRenderable(this.renderer, {
        id: `diff-entry-${this.entryCount}`,
        diff: unifiedDiff,
        view: 'unified',
        showLineNumbers: true,
        height: Math.min(lineCount + 2, 40),
        fg: theme.white,
        addedBg: '#0a3d0a',
        removedBg: '#3d0a0a',
        addedSignColor: theme.success,
        removedSignColor: theme.error,
        lineNumberFg: theme.muted,
        lineNumberBg: theme.bgPanel,
        wrapMode: 'word',
      });
      this.scrollBox.add(diff);
    } catch {
      // Fallback: render as plain text lines
      this.addDiffFallback(unifiedDiff);
    }

    // Prune old entries
    let children = this.scrollBox.getChildren();
    if (children.length > MAX_ENTRIES * 2) {
      const idsToRemove = children.slice(0, children.length - MAX_ENTRIES * 2).map(c => c.id);
      for (const id of idsToRemove) {
        this.scrollBox.remove(id);
      }
    }

    // Auto-show on first diff
    if (!this._visible) {
      this.show();
    }
  }

  /**
   * Build a unified diff string from before/after content.
   */
  private buildUnifiedDiff(filePath: string, before: string, after: string): string | null {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const regions = diffLines(beforeLines, afterLines);

    // Check if there are actual changes
    const hasChanges = regions.some(r => r.type !== 'equal');
    if (!hasChanges) return null;

    const hunks = this.buildHunks(regions, beforeLines, afterLines);
    if (hunks.length === 0) return null;

    const lines: string[] = [
      `--- a/${basename(filePath)}`,
      `+++ b/${basename(filePath)}`,
      ...hunks,
    ];

    return lines.join('\n');
  }

  /**
   * Build unified diff hunks with context lines from diff regions.
   */
  private buildHunks(
    regions: ReturnType<typeof diffLines>,
    _beforeLines: string[],
    _afterLines: string[],
  ): string[] {
    // Flatten regions into raw diff lines with original line numbers
    const rawLines: {
      text: string;
      type: 'ctx' | 'add' | 'del';
      oldLineNo: number;
      newLineNo: number;
    }[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const region of regions) {
      if (region.type === 'equal') {
        for (const line of region.oldLines) {
          rawLines.push({ text: ' ' + line, type: 'ctx', oldLineNo: oldLine, newLineNo: newLine });
          oldLine++;
          newLine++;
        }
      } else if (region.type === 'delete') {
        for (const line of region.oldLines) {
          rawLines.push({ text: '-' + line, type: 'del', oldLineNo: oldLine, newLineNo: newLine });
          oldLine++;
        }
      } else if (region.type === 'insert') {
        for (const line of region.newLines) {
          rawLines.push({ text: '+' + line, type: 'add', oldLineNo: oldLine, newLineNo: newLine });
          newLine++;
        }
      } else if (region.type === 'replace') {
        for (const line of region.oldLines) {
          rawLines.push({ text: '-' + line, type: 'del', oldLineNo: oldLine, newLineNo: newLine });
          oldLine++;
        }
        for (const line of region.newLines) {
          rawLines.push({ text: '+' + line, type: 'add', oldLineNo: oldLine, newLineNo: newLine });
          newLine++;
        }
      }
    }

    // Mark which lines to keep (within 3 context lines of a change)
    const contextRadius = 3;
    const keep = new Array(rawLines.length).fill(false);
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].type === 'add' || rawLines[i].type === 'del') {
        for (
          let j = Math.max(0, i - contextRadius);
          j <= Math.min(rawLines.length - 1, i + contextRadius);
          j++
        ) {
          keep[j] = true;
        }
      }
    }

    // Group kept lines into hunks separated by gaps
    const hunkGroups: number[][] = [];
    let currentGroup: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      if (keep[i]) {
        if (currentGroup.length > 0 && i - currentGroup[currentGroup.length - 1] > 1) {
          hunkGroups.push(currentGroup);
          currentGroup = [];
        }
        currentGroup.push(i);
      }
    }
    if (currentGroup.length > 0) hunkGroups.push(currentGroup);

    // Build hunk output, respecting MAX_DIFF_LINES
    const output: string[] = [];
    let totalLines = 0;

    for (const group of hunkGroups) {
      if (totalLines >= MAX_DIFF_LINES) {
        break;
      }

      // Compute hunk header from line numbers
      const firstIdx = group[0];
      const lastIdx = group[group.length - 1];

      let hunkOldStart = rawLines[firstIdx].oldLineNo;
      let hunkNewStart = rawLines[firstIdx].newLineNo;
      let hunkOldCount = 0;
      let hunkNewCount = 0;

      const hunkLines: string[] = [];
      for (const idx of group) {
        const rl = rawLines[idx];
        hunkLines.push(rl.text);
        if (rl.type === 'ctx') {
          hunkOldCount++;
          hunkNewCount++;
        } else if (rl.type === 'del') {
          hunkOldCount++;
        } else if (rl.type === 'add') {
          hunkNewCount++;
        }
      }

      output.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
      output.push(...hunkLines);
      totalLines += hunkLines.length + 1;
    }

    return output;
  }

  private addDiffFallback(diffContent: string): void {
    const lines = diffContent.split('\n');
    for (const line of lines) {
      this.entryCount++;
      let content;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        content = t`${fg(theme.success)(line)}`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        content = t`${fg(theme.error)(line)}`;
      } else if (line.startsWith('@@')) {
        content = t`${fg(theme.violet)(line)}`;
      } else {
        content = t`${dim(fg(theme.muted)(line))}`;
      }
      const text = new TextRenderable(this.renderer, {
        id: `diff-fallback-${this.entryCount}`,
        content,
      });
      this.scrollBox.add(text);
    }
  }

  show(): void {
    this._visible = true;
    this.container.visible = true;
    this.container.width = '40%';
  }

  hide(): void {
    this._visible = false;
    this.container.visible = false;
    this.container.width = 0;
  }

  toggle(): void {
    if (this._visible) {
      this.hide();
    } else if (this.hasEntries()) {
      this.show();
    }
  }

  hasEntries(): boolean {
    return this.entryCount > 0;
  }

  clear(): void {
    // Snapshot IDs first — removing during iteration mutates the array and crashes Bun/native
    const ids = this.scrollBox.getChildren().map(c => c.id);
    for (const id of ids) {
      this.scrollBox.remove(id);
    }
    this.entryCount = 0;
    this.hide();
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
