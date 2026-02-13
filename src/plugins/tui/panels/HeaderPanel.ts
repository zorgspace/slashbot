/**
 * HeaderPanel - Modern logo with shadow + version info + status indicators
 *
 * Combines logo, version/model/cwd info, and status dots.
 * Uses SplitBorder (dotted left/right rails) and backgroundPanel for depth.
 */

import { BoxRenderable, TextRenderable, t, fg, bold, dim, type CliRenderer } from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import type { SidebarData } from '../../../core/ui/types';

export interface HeaderOptions {
  version: string;
  workingDir: string;
  contextFile?: string | null;
}

const LOGO_LINES = [
  { main: ' ▄▄▄▄▄▄▄ ', shadow: '' },
  { main: '▐░░░░░░░▌', shadow: '' },
  { main: '▐░▀░░░▀░▌', shadow: '' },
  { main: '▐░░░▄░░░▌', shadow: '' },
  { main: '▐░░▀▀▀░░▌', shadow: '' },
  { main: ' ▀▀▀▀▀▀▀ ', shadow: '' },
];

export class HeaderPanel {
  private container: BoxRenderable;
  private renderer: CliRenderer;

  // Left info lines
  private titleText: TextRenderable;
  private cwdText: TextRenderable;
  private helpText: TextRenderable;

  // Right status line
  private statusText: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'header',
      flexDirection: 'row',
      alignItems: 'center',
      height: 8,
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      borderColor: theme.transparent,
      border: [],
    });

    // Logo with shadow
    const logoContent = LOGO_LINES.map(l => l.main + l.shadow).join('\n');
    const logoText = new TextRenderable(renderer, {
      id: 'header-logo',
      content: t`${fg(theme.accent)(logoContent)}`,
      width: 12,
    });

    // Info column (left side)
    const infoBox = new BoxRenderable(renderer, {
      id: 'header-info',
      flexDirection: 'column',
      flexGrow: 1,
      paddingLeft: 2,
    });

    this.titleText = new TextRenderable(renderer, {
      id: 'header-title',
      content: '',
      height: 1,
    });

    this.cwdText = new TextRenderable(renderer, {
      id: 'header-cwd',
      content: '',
      height: 1,
    });

    this.helpText = new TextRenderable(renderer, {
      id: 'header-help',
      content: '',
      height: 1,
    });

    infoBox.add(this.titleText);
    infoBox.add(this.cwdText);
    infoBox.add(this.helpText);

    // Status column (right side)
    const statusBox = new BoxRenderable(renderer, {
      id: 'header-status',
      flexDirection: 'column',
      width: 30,
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

    this.titleText.content = t`${bold(fg(theme.white)('SLASHBOT'))} ${fg(theme.accent)('v' + options.version)}`;
    this.cwdText.content = t`${dim(fg(theme.muted)(shortCwd))}`;

    if (options.contextFile) {
      this.helpText.content = t`${dim(fg(theme.muted)('ctx: ' + options.contextFile))}`;
    } else {
      this.helpText.content = t`${dim(fg(theme.muted)('? help · Tab complete'))}`;
    }
  }

  updateStatus(data: SidebarData): void {
    this.rebuildStatus(data);
  }

  private rebuildStatus(data: SidebarData): void {
    const statusBox = this.container.getChildren()[2]; // header-status
    if (!statusBox) return;

    // Snapshot IDs first to avoid mutation during iteration
    const ids = statusBox.getChildren().map(c => c.id);
    for (const id of ids) {
      statusBox.remove(id);
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

    // Model config block
    addLine(`model`, t`${fg(theme.primary)('◆')} ${data.model || '[none]'}`);

    // Render all dynamic sidebar items
    for (const item of data.items) {
      const dot = item.active ? '●' : '○';
      const dotColor = item.active ? theme.green : theme.muted;
      addLine(item.id, t`${fg(dotColor)(dot)} ${fg(theme.white)(item.label)}`);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
