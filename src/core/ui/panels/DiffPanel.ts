/**
 * DiffPanel - Right-side scrollable panel displaying unified diffs for edited files
 *
 * Auto-shows when edits happen, toggle with Ctrl+D.
 * Accumulates diffs across the session. Cleared on /clear.
 */

import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../theme';
import { diffLines } from '../../code/diff3';

const MAX_DIFF_LINES = 300;

export class DiffPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private _visible = false;
  private lineCounter = 0;
  private entryCount = 0;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'diff-container',
      width: 0,
      flexDirection: 'column',
      borderColor: theme.violetDark,
      border:["left"],
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
   * Add a diff for an edited file. Computes unified diff and appends to panel.
   */
  addDiff(filePath: string, before: string, after: string): void {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const regions = diffLines(beforeLines, afterLines);

    // Build diff output lines
    const diffOutput: { text: string; type: 'header' | 'add' | 'del' | 'ctx' }[] = [];

    for (const region of regions) {
      if (region.type === 'equal') {
        // Show context lines (max 2 around changes)
        for (const line of region.oldLines) {
          diffOutput.push({ text: ' ' + line, type: 'ctx' });
        }
      } else if (region.type === 'delete' || region.type === 'replace') {
        for (const line of region.oldLines) {
          diffOutput.push({ text: '-' + line, type: 'del' });
        }
        if (region.type === 'replace') {
          for (const line of region.newLines) {
            diffOutput.push({ text: '+' + line, type: 'add' });
          }
        }
      } else if (region.type === 'insert') {
        for (const line of region.newLines) {
          diffOutput.push({ text: '+' + line, type: 'add' });
        }
      }
    }

    // Trim context: keep only 2 context lines around changes
    const trimmed = this.trimContext(diffOutput);

    // Truncate if too long
    const truncated = trimmed.length > MAX_DIFF_LINES;
    const lines = truncated ? trimmed.slice(0, MAX_DIFF_LINES) : trimmed;

    this.entryCount++;

    // File header
    this.addLine(t`${bold(fg(theme.violet)('--- ' + filePath))}`);

    // Diff lines
    for (const line of lines) {
      if (line.type === 'add') {
        this.addLine(t`${fg(theme.green)(line.text)}`);
      } else if (line.type === 'del') {
        this.addLine(t`${fg(theme.red)(line.text)}`);
      } else {
        this.addLine(t`${dim(fg(theme.muted)(line.text))}`);
      }
    }

    if (truncated) {
      this.addLine(t`${dim(fg(theme.warning)('... (' + (trimmed.length - MAX_DIFF_LINES) + ' more lines)'))}`);
    }

    // Separator
    this.addLine(t`${dim(fg(theme.muted)(''))}`);

    // Auto-show on first diff
    if (!this._visible) {
      this.show();
    }
  }

  /**
   * Trim context lines: keep only 2 lines of context around add/del regions.
   * Insert separator markers between disconnected hunks.
   */
  private trimContext(
    lines: { text: string; type: 'header' | 'add' | 'del' | 'ctx' }[],
  ): { text: string; type: 'header' | 'add' | 'del' | 'ctx' }[] {
    if (lines.length === 0) return [];

    // Mark which lines are within 2 of a change
    const keep = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type === 'add' || lines[i].type === 'del') {
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
          keep[j] = true;
        }
      }
    }

    const result: { text: string; type: 'header' | 'add' | 'del' | 'ctx' }[] = [];
    let lastKept = -1;
    for (let i = 0; i < lines.length; i++) {
      if (keep[i]) {
        if (lastKept >= 0 && i - lastKept > 1) {
          result.push({ text: ' ...', type: 'ctx' });
        }
        result.push(lines[i]);
        lastKept = i;
      }
    }

    return result;
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
    for (const child of this.scrollBox.getChildren()) {
      this.scrollBox.remove(child.id);
    }
    this.lineCounter = 0;
    this.entryCount = 0;
    this.hide();
  }

  private addLine(content: any): void {
    this.lineCounter++;
    const line = new TextRenderable(this.renderer, {
      id: `diff-line-${this.lineCounter}`,
      content,
      selectionBg: theme.violetDark,
      selectionFg: theme.white,
    });
    this.scrollBox.add(line);

    // Keep max 500 entries
    const children = this.scrollBox.getChildren();
    if (children.length > 500) {
      this.scrollBox.remove(children[0].id);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
