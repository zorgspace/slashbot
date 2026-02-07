/**
 * HeaderPanel - ASCII skull banner + version info + status indicators
 *
 * Combines the old header and sidebar into a single compact zone.
 * Left: skull logo + version/model/cwd. Right: status dots.
 */

import { BoxRenderable, TextRenderable, t, fg, bold, dim, type CliRenderer } from '@opentui/core';
import { theme } from '../theme';
import type { SidebarData } from '../types';

export interface HeaderOptions {
  version: string;
  workingDir: string;
  contextFile?: string | null;
}

const SKULL_LINES = [
  ' \u2584\u2584\u2584\u2584\u2584\u2584\u2584 ',
  '\u2590\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u258C',
  '\u2590\u2591\u2580\u2591\u2591\u2591\u2580\u2591\u258C',
  '\u2590\u2591\u2591\u2591\u2584\u2591\u2591\u2591\u258C',
  '\u2590\u2591\u2591\u2580\u2580\u2580\u2591\u2591\u258C',
  ' \u2580\u2580\u2580\u2580\u2580\u2580\u2580 ',
];

export class HeaderPanel {
  private container: BoxRenderable;
  private renderer: CliRenderer;

  // Left info lines
  private titleText: TextRenderable;
  private contextText: TextRenderable;
  private helpText: TextRenderable;

  // Right status line
  private statusText: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'header',
      flexDirection: 'row',
      alignItems: 'center',
      height: 7,
      paddingLeft: 1,
      border: ['bottom'],
      borderColor: theme.border,
    });

    // Logo
    const logoText = new TextRenderable(renderer, {
      id: 'header-logo',
      content: t`${fg(theme.violet)(SKULL_LINES.join('\n'))}`,
      width: 11,
    });

    // Info column (left side)
    const infoBox = new BoxRenderable(renderer, {
      id: 'header-info',
      flexDirection: 'column',
      flexGrow: 1,
      paddingLeft: 1,
    });

    this.titleText = new TextRenderable(renderer, {
      id: 'header-title',
      content: '',
      height: 1,
    });

    this.contextText = new TextRenderable(renderer, {
      id: 'header-context',
      content: '',
      height: 1,
    });

    this.helpText = new TextRenderable(renderer, {
      id: 'header-help',
      content: '',
      height: 1,
    });

    infoBox.add(this.titleText);
    infoBox.add(this.contextText);
    infoBox.add(this.helpText);

    // Status column (right side)
    const statusBox = new BoxRenderable(renderer, {
      id: 'header-status',
      flexDirection: 'column',
      width: 28,
      paddingRight: 1,
    });

    this.statusText = new TextRenderable(renderer, {
      id: 'header-status-text',
      content: '',
    });

    statusBox.add(this.statusText);

    this.container.add(logoText);
    this.container.add(infoBox);
    this.container.add(statusBox);
  }

  setOptions(options: HeaderOptions): void {
    const shortCwd = options.workingDir.replace(process.env.HOME || '', '~');

    this.titleText.content = t`${bold(fg(theme.white)('SLASHBOT'))} ${fg(theme.violet)('v' + options.version)} ${dim(fg(theme.muted)(shortCwd))}`;

    if (options.contextFile) {
      this.contextText.content = t`${dim(fg(theme.muted)('Context: ' + options.contextFile))}`;
      this.helpText.content = t`${dim(fg(theme.muted)('? help \u00B7 Tab complete'))}`;
    } else {
      this.contextText.content = t`${dim(fg(theme.muted)('? help \u00B7 Tab complete'))}`;
      this.helpText.content = '';
    }
  }

  updateStatus(data: SidebarData): void {
    this.rebuildStatus(data);
  }

  private rebuildStatus(data: SidebarData): void {
    const statusBox = this.container.getChildren()[2]; // header-status
    if (!statusBox) return;

    // Remove old status children
    for (const child of statusBox.getChildren()) {
      statusBox.remove(child.id);
    }

    let lineIdx = 0;
    const addLine = (id: string, content: any) => {
      const text = new TextRenderable(this.renderer, {
        id: `hdr-st-${id}-${lineIdx++}`,
        content,
        height: 1,
      });
      statusBox.add(text);
    };

    // Render all dynamic sidebar items
    for (const item of data.items) {
      const dot = item.active ? '\u25CF' : '\u25CB';
      const dotColor = item.active ? theme.green : theme.muted;
      addLine(item.id, t`${fg(dotColor)(dot)} ${fg(theme.white)(item.label)}`);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
