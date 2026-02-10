/**
 * CommandPalettePanel - Compact command palette shown above input on Tab
 *
 * Displays grouped slash commands in a compact format.
 * Hidden by default; shown when the user presses Tab while input starts with '/'.
 * Uses SplitBorder and backgroundPanel for visual consistency.
 */

import { BoxRenderable, TextRenderable, t, fg, bold, type CliRenderer } from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import { SplitBorder } from '../borders';
import { getGroupedCommands, getSubcommands } from '../../../core/commands/parser';

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
      ...SplitBorder,
      borderColor: theme.borderSubtle,
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
    // Clear previous content
    this.clearContent();

    // Check if we're in subcommand context (e.g. "/wallet " or "/wallet s")
    const trimmed = filter.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 1 && parts[0].startsWith('/')) {
      const baseCmd = parts[0];
      const subs = getSubcommands(baseCmd);
      if (subs.length > 0) {
        const subPrefix = parts.length >= 2 ? parts.slice(1).join(' ').toLowerCase() : '';
        this.showSubcommands(baseCmd, subs, subPrefix);
        return;
      }
    }

    // Regular command palette
    const groups = getGroupedCommands();
    const prefix = filter.startsWith('/') ? filter.slice(1).toLowerCase() : '';

    // Build one line per group
    for (const group of groups) {
      this.lineCounter++;
      const cmdStr = group.cmds
        .map(cmd => {
          const matches = !prefix || cmd.name.startsWith(prefix);
          return prefix && matches ? cmd.name.toUpperCase() : cmd.name;
        })
        .join(' ');

      const hasMatch = !prefix || group.cmds.some(cmd => cmd.name.startsWith(prefix));
      const titleColor = hasMatch ? theme.accent : theme.muted;
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
          content: t`${fg(theme.primary)('Matches:')} ${bold(fg(theme.white)(matchStr))}`,
          height: 1,
        });
        this.container.add(matchLine);
      }
    }

    const lineCount = this.lineCounter;
    this.container.height = lineCount + 2;
    this.container.visible = true;
    this._visible = true;
  }

  /**
   * Show subcommand suggestions for a command
   */
  private showSubcommands(baseCmd: string, subs: string[], subPrefix: string): void {
    this.lineCounter++;
    const cmdName = baseCmd.startsWith('/') ? baseCmd.slice(1) : baseCmd;

    const subStr = subs
      .map(sub => {
        const matches = !subPrefix || sub.startsWith(subPrefix);
        return subPrefix && matches ? sub.toUpperCase() : sub;
      })
      .join('  ');

    const content = t`${bold(fg(theme.accent)(cmdName + ':'))} ${fg(theme.muted)(subStr)}`;

    const text = new TextRenderable(this.renderer, {
      id: `palette-line-${this.lineCounter}`,
      content,
      height: 1,
    });
    this.container.add(text);

    // Show filtered matches if prefix is provided
    if (subPrefix) {
      const matching = subs.filter(s => s.startsWith(subPrefix));
      if (matching.length > 0 && matching.length < subs.length) {
        this.lineCounter++;
        const matchStr = matching.map(s => `${baseCmd} ${s}`).join('  ');
        const matchLine = new TextRenderable(this.renderer, {
          id: `palette-line-${this.lineCounter}`,
          content: t`${fg(theme.primary)('Matches:')} ${bold(fg(theme.white)(matchStr))}`,
          height: 1,
        });
        this.container.add(matchLine);
      }
    }

    const lineCount = this.lineCounter;
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
