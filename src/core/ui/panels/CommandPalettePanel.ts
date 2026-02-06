/**
 * CommandPalettePanel - Compact command palette shown above input on Tab
 *
 * Displays grouped slash commands in a compact format.
 * Hidden by default; shown when the user presses Tab while input starts with '/'.
 */

import { BoxRenderable, TextRenderable, t, fg, bold, type CliRenderer } from '@opentui/core';
import { theme } from '../theme';
import { getGroupedCommands } from '../../commands/parser';

export class CommandPalettePanel {
  private container: BoxRenderable;
  private renderer: CliRenderer;
  private _visible = false;
  private lineCounter = 0;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'command-palette',
      height: 0,
      flexDirection: 'column',
      border: true,
      borderColor: theme.violetDark,
      paddingLeft: 1,
      paddingRight: 1,
      visible: false,
    });
  }

  /**
   * Show the palette with commands matching the given filter prefix.
   * @param filter - current input value (e.g. "/he")
   */
  show(filter: string): void {
    const groups = getGroupedCommands();
    const prefix = filter.startsWith('/') ? filter.slice(1).toLowerCase() : '';

    // Clear previous content
    this.clearContent();

    // Build one line per group
    for (const group of groups) {
      this.lineCounter++;
      const cmdStr = group.cmds
        .map(cmd => {
          const matches = !prefix || cmd.name.startsWith(prefix);
          return prefix && matches ? cmd.name.toUpperCase() : cmd.name;
        })
        .join(' ');

      // Format: "GroupTitle: cmd1 cmd2 cmd3"
      // Using plain string since t`` with dynamic styled segments is complex
      // Title in bold violet, commands in appropriate color
      const hasMatch = !prefix || group.cmds.some(cmd => cmd.name.startsWith(prefix));
      const titleColor = hasMatch ? theme.violet : theme.muted;
      const content = t`${bold(fg(titleColor)(group.title + ':'))} ${fg(theme.muted)(cmdStr)}`;

      const text = new TextRenderable(this.renderer, {
        id: `palette-line-${this.lineCounter}`,
        content,
        height: 1,
      });
      this.container.add(text);
    }

    // If we have a prefix, add a line showing matching commands highlighted
    if (prefix) {
      const allMatching = groups.flatMap(g =>
        g.cmds.filter(cmd => cmd.name.startsWith(prefix)).map(cmd => cmd.name),
      );
      if (allMatching.length > 0) {
        this.lineCounter++;
        const matchStr = allMatching.map(n => '/' + n).join('  ');
        const matchLine = new TextRenderable(this.renderer, {
          id: `palette-line-${this.lineCounter}`,
          content: t`${fg(theme.violetLight)('Matches:')} ${bold(fg(theme.white)(matchStr))}`,
          height: 1,
        });
        this.container.add(matchLine);
      }
    }

    const lineCount = this.lineCounter;
    // Size: lines + 2 for border
    this.container.height = lineCount + 2;
    this.container.visible = true;
    this._visible = true;
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.container.visible = false;
    this.container.height = 0;
    this.clearContent();
  }

  isVisible(): boolean {
    return this._visible;
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }

  private clearContent(): void {
    const children = this.container.getChildren();
    for (const child of children) {
      this.container.remove(child.id);
    }
    this.lineCounter = 0;
  }
}
