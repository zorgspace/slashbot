import { BoxRenderable, TextRenderable, t, fg, bg, bold, type CliRenderer } from '@opentui/core';
import { theme } from '../../../core/ui/theme';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsPanelCallbacks {
  onSelect?: (tabId: string) => void | Promise<void>;
  onCreateAgent?: () => void;
  onEditAgent?: (agentId: string) => void;
}

export class TabsPanel {
  private container: BoxRenderable;
  private renderer: CliRenderer;
  private tabs: TabItem[] = [];
  private activeTabId = 'agents';
  private callbacks: TabsPanelCallbacks;

  constructor(renderer: CliRenderer, callbacks: TabsPanelCallbacks = {}) {
    this.renderer = renderer;
    this.callbacks = callbacks;

    this.container = new BoxRenderable(renderer, {
      id: 'tabs-panel',
      height: 3,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 2,
      paddingRight: 2,
      border: ['bottom'],
      borderColor: theme.borderSubtle,
    });
    this.container.selectable = false;
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
    const cleaned = label.trim();
    if (cleaned.length <= 18) {
      return cleaned;
    }
    return `${cleaned.slice(0, 15)}...`;
  }

  private rebuild(): void {
    const ids = this.container.getChildren().map(c => c.id);
    for (const id of ids) {
      this.container.remove(id);
    }

    for (const tab of this.tabs) {
      const isActive = tab.id === this.activeTabId;
      const label = this.formatLabel(tab.label);
      const tabText = new TextRenderable(this.renderer, {
        id: `tab-${tab.id}`,
        content: isActive
          ? t`${bg(theme.accent)(bold(fg(theme.bg)(`  ${label}  `)))}`
          : t`${bg(theme.borderSubtle)(fg(theme.white)(`  ${label}  `))}`,
        selectable: false,
      });
      tabText.onMouseDown = event => {
        event.preventDefault();
        event.stopPropagation();
        const previousTabId = this.activeTabId;
        this.activeTabId = tab.id;
        this.rebuild();
        const maybePromise = this.callbacks.onSelect?.(tab.id);
        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          void (maybePromise as Promise<void>).catch(() => {
            this.activeTabId = previousTabId;
            this.rebuild();
          });
        }
      };
      this.container.add(tabText);

      const gap = new TextRenderable(this.renderer, {
        id: `tab-gap-${tab.id}`,
        content: ' ',
        selectable: false,
      });
      this.container.add(gap);
    }

    const spacer = new BoxRenderable(this.renderer, {
      id: 'tabs-spacer',
      flexGrow: 1,
    });
    this.container.add(spacer);

    const createBtn = new TextRenderable(this.renderer, {
      id: 'tabs-create',
      content: t`${bg(theme.primary)(bold(fg(theme.bg)(' + New Agent ')))}`,
      selectable: false,
    });
    createBtn.onMouseDown = event => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onCreateAgent?.();
    };
    this.container.add(createBtn);

    if (this.activeTabId !== 'agents') {
      const editGap = new TextRenderable(this.renderer, {
        id: 'tabs-edit-gap',
        content: ' ',
        selectable: false,
      });
      this.container.add(editGap);

      const editBtn = new TextRenderable(this.renderer, {
        id: 'tabs-edit',
        content: t`${bg(theme.accent)(bold(fg(theme.bg)(' Edit Agent ')))}`,
        selectable: false,
      });
      editBtn.onMouseDown = event => {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onEditAgent?.(this.activeTabId);
      };
      this.container.add(editBtn);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
