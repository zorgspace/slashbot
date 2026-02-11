/**
 * TodoNotification - Persistent task list + completion flash
 *
 * Shows above input with all current todos and status labels.
 * Visible whenever there are non-completed todos.
 * Briefly flashes green border on completion.
 */

import { BoxRenderable, TextRenderable, t, fg, bold, dim, type CliRenderer } from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import { TopBorder } from '../borders';

export interface NotificationItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const STATUS_ICON: Record<string, string> = {
  pending: '\u25CB', // ○
  in_progress: '\u25B6', // ▶
  completed: '\u2713', // ✓
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'pending',
  in_progress: 'in progress',
  completed: 'done',
};

export class NotificationPanel {
  private renderer: CliRenderer;
  private container: BoxRenderable;
  private headerText: TextRenderable;
  private lineIds: string[] = [];
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    this.container = new BoxRenderable(renderer, {
      id: 'todo-notification',
      height: 0,
      flexDirection: 'column',
      ...TopBorder,
      borderColor: theme.borderSubtle,
      visible: false,
      paddingLeft: 1,
    });

    this.headerText = new TextRenderable(renderer, {
      id: 'todo-header',
      height: 1,
    });
    this.headerText.content = t`${bold(fg(theme.accent)('Tasks'))}`;
    this.container.add(this.headerText);
  }

  /**
   * Update the full task list display.
   * Shows when there are active (non-completed) todos, hides when all done or empty.
   */
  updateNotificationList(items: NotificationItem[]): void {
    // Remove old todo lines (snapshot IDs first to avoid live-array mutation)
    const ids = [...this.lineIds];
    for (const id of ids) {
      this.container.remove(id);
    }
    this.lineIds = [];

    const hasActive = items.some(i => i.status !== 'completed');

    if (items.length === 0 || !hasActive) {
      this.container.visible = false;
      this.container.height = 0;
      return;
    }

    // Add a TextRenderable per todo item
    for (const item of items) {
      const icon = STATUS_ICON[item.status] || '\u25CF';
      const label = STATUS_LABEL[item.status] || item.status;
      const lineId = `todo-line-${item.id}`;

      const line = new TextRenderable(this.renderer, {
        id: lineId,
        height: 1,
      });

      if (item.status === 'completed') {
        line.content = t`  ${dim(fg(theme.muted)(`${icon} ${item.content}`))} ${dim(fg(theme.muted)(label))}`;
      } else if (item.status === 'in_progress') {
        line.content = t`  ${fg(theme.primary)(`${icon} ${item.content}`)} ${dim(fg(theme.primary)(label))}`;
      } else {
        line.content = t`  ${fg(theme.white)(`${icon} ${item.content}`)} ${dim(fg(theme.muted)(label))}`;
      }

      this.container.add(line);
      this.lineIds.push(lineId);
    }

    // height = 1 (top border) + 1 (header) + item count
    this.container.height = 2 + items.length;
    this.container.visible = true;
  }

  /**
   * Flash the border green briefly to signal a completion event.
   */
  showNotification(text: string): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
    }
    this.container.borderColor = theme.success;
    this.headerText.content = t`${bold(fg(theme.success)('\u2713 Done:'))} ${text}`;

    this.flashTimer = setTimeout(() => {
      this.container.borderColor = theme.borderSubtle;
      this.headerText.content = t`${bold(fg(theme.accent)('Tasks'))}`;
      this.flashTimer = null;
    }, 2000);
  }

  hide(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.container.visible = false;
    this.container.height = 0;
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
