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
  model?: string;
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
  private modelText: TextRenderable;
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

    this.modelText = new TextRenderable(renderer, {
      id: 'header-model',
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
    infoBox.add(this.modelText);
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

    this.titleText.content = t`${bold(fg(theme.white)('SLASHBOT'))} ${fg(theme.violet)('v' + options.version)}`;
    this.modelText.content = t`${dim(fg(theme.muted)(shortCwd))}`;

    if (options.contextFile) {
      this.contextText.content = t`${dim(fg(theme.muted)('Context: ' + options.contextFile))}`;
      this.helpText.content = t`${dim(fg(theme.muted)('? help \u00B7 Tab complete'))}`;
    } else {
      this.contextText.content = t`${dim(fg(theme.muted)('? help \u00B7 Tab complete'))}`;
      this.helpText.content = '';
    }
  }

  updateStatus(data: SidebarData): void {
    // Build a compact multi-line status display
    const lines: string[] = [];

    // Connectors
    for (const conn of data.connectors) {
      const dot = conn.active ? '\u25CF' : '\u25CB';
      lines.push(`${dot} ${conn.name}`);
    }

    // Heartbeat
    const hbDot = data.heartbeat.running ? '\u25CF' : '\u25CB';
    lines.push(`${hbDot} Heartbeat`);

    // Wallet
    const walletDot = data.wallet.unlocked ? '\u25CF' : '\u25CB';
    lines.push(`${walletDot} Wallet`);

    // Model + tasks
    lines.push(`${data.model} \u00B7 ${data.tasks.count} tasks`);

    // Rebuild the status text using a single styled content
    // Use color per line based on active state
    this.rebuildStatus(data);
  }

  private rebuildStatus(data: SidebarData): void {
    // We need individual TextRenderables per line for proper styling.
    // But statusText is a single renderable — use parent statusBox instead.
    // Actually, we'll use a simpler approach: rebuild with a single content
    // that uses styled segments per line joined by newlines.
    // Since t`` returns StyledText, we can't join them.
    // Instead, replace statusText with a column box of lines.

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

    // Connectors
    for (const conn of data.connectors) {
      const dot = conn.active ? '\u25CF' : '\u25CB';
      const dotColor = conn.active ? theme.green : theme.red;
      addLine(`conn-${conn.name}`, t`${fg(dotColor)(dot)} ${fg(theme.white)(conn.name)}`);
    }

    // Heartbeat
    const hbDot = data.heartbeat.running ? '\u25CF' : '\u25CB';
    const hbColor = data.heartbeat.running ? theme.green : theme.muted;
    addLine('hb', t`${fg(hbColor)(hbDot)} ${fg(theme.white)('Heartbeat')}`);

    // Wallet
    const walletDot = data.wallet.unlocked ? '\u25CF' : '\u25CB';
    const walletColor = data.wallet.unlocked ? theme.green : theme.muted;
    addLine('wallet', t`${fg(walletColor)(walletDot)} ${fg(theme.white)('Wallet')}`);

    addLine('tasks', t`${dim(fg(theme.muted)(data.tasks.count + ' tasks'))}`);
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
