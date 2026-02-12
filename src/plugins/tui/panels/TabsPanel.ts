import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  t,
  fg,
  bg,
  bold,
  dim,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../../../core/ui/theme';

export interface TabItem {
  id: string;
  label: string;
  section?: 'agents' | 'connectors' | (string & {});
  editable?: boolean;
  removable?: boolean;
}

export interface TabsPanelCallbacks {
  onSelect?: (tabId: string, previousTabId: string) => void | Promise<void>;
  onCreateAgent?: () => void;
  onEditAgent?: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => void;
}

export class TabsPanel {
  private container: BoxRenderable;
  private titleText: TextRenderable;
  private controlsRow: BoxRenderable;
  private listScroll: ScrollBoxRenderable;
  private titleMeta: TextRenderable;
  private renderer: CliRenderer;
  private tabs: TabItem[] = [];
  private activeTabId = 'agents';
  private callbacks: TabsPanelCallbacks;

  private readonly ACTIVE_MARKER = '▸';
  private readonly ACTIVE_ROW_COLOR = theme.violet;
  private readonly BORDER_COLOR = theme.accentMuted;

  constructor(renderer: CliRenderer, callbacks: TabsPanelCallbacks = {}) {
    this.renderer = renderer;
    this.callbacks = callbacks;

    this.container = new BoxRenderable(renderer, {
      id: 'tabs-panel',
      width: 30,
      height: '100%',
      flexDirection: 'column',
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      border: [],
    });
    this.container.selectable = false;

    const titleRow = new BoxRenderable(renderer, {
      id: 'tabs-title-row',
      height: 1,
      flexDirection: 'row',
      alignItems: 'center',
    });

    this.titleText = new TextRenderable(renderer, {
      id: 'tabs-title',
      content: '',
      selectable: false,
    });
    this.titleMeta = new TextRenderable(renderer, {
      id: 'tabs-title-meta',
      content: '',
      selectable: false,
    });

    titleRow.add(this.titleText);
    titleRow.add(
      new BoxRenderable(renderer, {
        id: 'tabs-title-spacer',
        flexGrow: 1,
      }),
    );
    titleRow.add(this.titleMeta);
    this.container.add(titleRow);

    this.controlsRow = new BoxRenderable(renderer, {
      id: 'tabs-controls',
      height: 1,
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 1,
    });
    this.container.add(this.controlsRow);

    this.listScroll = new ScrollBoxRenderable(renderer, {
      id: 'tabs-list-scroll',
      flexGrow: 1,
      marginTop: 1,
      stickyScroll: false,
      paddingRight: 1,
    });
    this.container.add(this.listScroll);

    this.rebuild();
  }

  setTabs(tabs: TabItem[], activeTabId: string): void {
    this.tabs = tabs;
    this.activeTabId = activeTabId;
    this.rebuild();
  }

  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
    this.rebuild();
  }

  getActiveTabId(): string {
    return this.activeTabId;
  }

  private formatLabel(label: string): string {
    const trimmed = label.trim();
    const source = trimmed.toLowerCase() === 'agents' ? 'Overview' : trimmed;
    if (source.length <= 23) {
      return source;
    }
    return `${source.slice(0, 20)}...`;
  }

  private formatSectionLabel(section: string): string {
    const normalized = section.trim().toLowerCase();
    if (normalized === 'agents') return 'Agents';
    if (normalized === 'connectors') return 'Connector Chats';
    if (!normalized) return 'Tabs';
    return normalized[0].toUpperCase() + normalized.slice(1);
  }

  private getActiveTab(): TabItem | undefined {
    return this.tabs.find(tab => tab.id === this.activeTabId);
  }

  private addControlGap(id: string): void {
    this.controlsRow.add(
      new TextRenderable(this.renderer, {
        id,
        content: ' ',
        selectable: false,
      }),
    );
  }

  private addControlButton(
    id: string,
    label: string,
    options: { enabled: boolean; onClick: () => void; accent?: boolean },
  ): void {
    const content = options.enabled
      ? options.accent
        ? t`${bg(this.ACTIVE_ROW_COLOR)(bold(fg(theme.bg)(` ${label} `)))}`
        : t`${bg(theme.bgElement)(fg(theme.white)(` ${label} `))}`
      : t`${bg(theme.bgElement)(dim(fg(theme.muted)(` ${label} `)))}`;

    const button = new TextRenderable(this.renderer, {
      id,
      content,
      selectable: false,
    });

    if (options.enabled) {
      button.onMouseDown = event => {
        event.preventDefault();
        event.stopPropagation();
        options.onClick();
      };
    }

    this.controlsRow.add(button);
  }

  private padLabel(label: string, width: number): string {
    if (label.length >= width) {
      return label.slice(0, width);
    }
    return label + ' '.repeat(width - label.length);
  }

  private rebuild(): void {
    this.container.borderColor = this.BORDER_COLOR;
    this.titleText.content = t`${bold(fg(this.ACTIVE_ROW_COLOR)('Explorer'))}`;

    const agentCount = this.tabs.filter(
      tab => tab.section === 'agents' && tab.id !== 'agents',
    ).length;
    const connectorCount = this.tabs.filter(tab => tab.section === 'connectors').length;
    const counts: string[] = [];
    counts.push(`${Math.max(0, agentCount)} agents`);
    if (connectorCount > 0) {
      counts.push(`${connectorCount} chats`);
    }
    this.titleMeta.content = t`${dim(fg(theme.muted)(counts.join(' • ')))}`;

    const controlIds = this.controlsRow.getChildren().map(c => c.id);
    for (const id of controlIds) {
      this.controlsRow.remove(id);
    }

    const activeTab = this.getActiveTab();
    const canEdit = activeTab?.editable ?? false;
    const canDelete = activeTab?.removable ?? false;

    this.addControlButton('tabs-create', '+ New', {
      enabled: true,
      onClick: () => this.callbacks.onCreateAgent?.(),
      accent: true,
    });
    this.addControlGap('tabs-controls-gap-1');
    this.addControlButton('tabs-edit', 'Edit', {
      enabled: canEdit,
      onClick: () => this.callbacks.onEditAgent?.(this.activeTabId),
    });
    this.addControlGap('tabs-controls-gap-2');
    this.addControlButton('tabs-delete', 'Delete', {
      enabled: canDelete,
      onClick: () => this.callbacks.onDeleteAgent?.(this.activeTabId),
    });

    const listIds = this.listScroll.getChildren().map(c => c.id);
    for (const id of listIds) {
      this.listScroll.remove(id);
    }

    let currentSection = '';
    let rowIndex = 0;
    for (const tab of this.tabs) {
      const nextSection = tab.section || 'tabs';
      if (nextSection !== currentSection) {
        currentSection = nextSection;
        const sectionRow = new TextRenderable(this.renderer, {
          id: `tab-section-${rowIndex++}`,
          content: t`${dim(fg(theme.muted)(`╭ ${this.formatSectionLabel(currentSection).toUpperCase()}`))}`,
          selectable: false,
        });
        this.listScroll.add(sectionRow);
      }

      const isActive = tab.id === this.activeTabId;
      const label = this.formatLabel(tab.label);
      const padded = this.padLabel(label, 23);
      const idleMarker = tab.section === 'connectors' ? '◦' : '·';
      const row = new TextRenderable(this.renderer, {
        id: `tab-${rowIndex++}`,
        content: isActive
          ? t`${bg(this.ACTIVE_ROW_COLOR)(bold(fg(theme.bg)(` ${this.ACTIVE_MARKER} ${padded}`)))}`
          : t`${fg(theme.muted)(` ${idleMarker} `)}${fg(theme.white)(padded)}`,
        selectable: false,
      });

      row.onMouseDown = event => {
        event.preventDefault();
        event.stopPropagation();
        const previousTabId = this.activeTabId;
        this.activeTabId = tab.id;
        this.rebuild();
        const maybePromise = this.callbacks.onSelect?.(tab.id, previousTabId);
        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          void (maybePromise as Promise<void>).catch(() => {
            this.activeTabId = previousTabId;
            this.rebuild();
          });
        }
      };

      this.listScroll.add(row);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }

  destroy(): void {}
}
