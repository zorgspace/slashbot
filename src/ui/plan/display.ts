/**
 * Plan Display Component - Beautiful task tracking
 */

import { colors } from '../core';

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanDisplayItem {
  id: string;
  content: string;
  status: PlanItemStatus;
  description?: string;
}

/**
 * Beautiful plan display component for task tracking
 * Supports pending, in_progress, and completed states
 */
export class PlanDisplay {
  private maxWidth: number;

  constructor() {
    this.maxWidth = Math.min(process.stdout.columns || 80, 70);
  }

  /**
   * Get status icon and color for a plan item
   */
  private getStatusStyle(status: PlanItemStatus): { icon: string; color: string; bgColor: string } {
    switch (status) {
      case 'completed':
        return {
          icon: '✓',
          color: colors.success,
          bgColor: colors.bgGreen,
        };
      case 'in_progress':
        return {
          icon: '◉',
          color: colors.warning,
          bgColor: `\x1b[48;5;58m`, // Dark yellow/orange background
        };
      case 'pending':
      default:
        return {
          icon: '○',
          color: colors.muted,
          bgColor: '',
        };
    }
  }

  /**
   * Render a single plan item
   */
  private renderItem(item: PlanDisplayItem, index: number, total: number): string {
    const style = this.getStatusStyle(item.status);
    const isLast = index === total - 1;
    const connector = isLast ? '╰' : '├';
    const linePrefix = isLast ? ' ' : '│';

    // Status badge
    const statusLabel = item.status === 'in_progress' ? 'IN PROGRESS' : item.status.toUpperCase();
    const statusBadge =
      item.status === 'in_progress'
        ? `${colors.warning}[${statusLabel}]${colors.reset}`
        : item.status === 'completed'
          ? `${colors.success}[${statusLabel}]${colors.reset}`
          : `${colors.muted}[${statusLabel}]${colors.reset}`;

    // Main line
    const contentWidth = this.maxWidth - 8;
    const truncatedContent =
      item.content.length > contentWidth
        ? item.content.slice(0, contentWidth - 3) + '...'
        : item.content;

    let output = `${colors.violet}${connector}─${colors.reset} ${style.color}${style.icon}${colors.reset} ${colors.white}${truncatedContent}${colors.reset}\n`;

    // Status badge on second line
    output += `${colors.violet}${linePrefix}${colors.reset}     ${statusBadge}\n`;

    // Description if present
    if (item.description) {
      const descWidth = this.maxWidth - 10;
      const truncatedDesc =
        item.description.length > descWidth
          ? item.description.slice(0, descWidth - 3) + '...'
          : item.description;
      output += `${colors.violet}${linePrefix}${colors.reset}     ${colors.muted}${truncatedDesc}${colors.reset}\n`;
    }

    return output;
  }

  /**
   * Display the full plan with all items
   */
  display(items: PlanDisplayItem[], title = 'Plan'): void {
    if (items.length === 0) {
      console.log(`${colors.muted}No tasks in plan${colors.reset}`);
      return;
    }

    // Count stats
    const completed = items.filter(i => i.status === 'completed').length;
    const inProgress = items.filter(i => i.status === 'in_progress').length;
    const pending = items.filter(i => i.status === 'pending').length;

    // Progress bar
    const progressWidth = 20;
    const progressFilled = Math.round((completed / items.length) * progressWidth);
    const progressEmpty = progressWidth - progressFilled;
    const progressBar = `${colors.success}${'█'.repeat(progressFilled)}${colors.reset}${colors.muted}${'░'.repeat(progressEmpty)}${colors.reset}`;
    const progressPercent = Math.round((completed / items.length) * 100);

    // Header
    const headerLine = '─'.repeat(this.maxWidth - 4);
    console.log(
      `\n${colors.violet}╭─ ${colors.bold}${title}${colors.reset}${colors.violet} ${headerLine.slice(title.length + 1)}${colors.reset}`,
    );

    // Progress line
    console.log(
      `${colors.violet}│${colors.reset} ${progressBar} ${colors.white}${progressPercent}%${colors.reset} ${colors.muted}(${completed}/${items.length} completed)${colors.reset}`,
    );

    // Stats line
    const statsLine = [
      pending > 0 ? `${colors.muted}○ ${pending} pending${colors.reset}` : '',
      inProgress > 0 ? `${colors.warning}◉ ${inProgress} in progress${colors.reset}` : '',
      completed > 0 ? `${colors.success}✓ ${completed} completed${colors.reset}` : '',
    ]
      .filter(s => s)
      .join('  ');
    console.log(`${colors.violet}│${colors.reset} ${statsLine}`);

    // Separator
    console.log(`${colors.violet}├${'─'.repeat(this.maxWidth - 2)}${colors.reset}`);

    // Items
    items.forEach((item, index) => {
      process.stdout.write(this.renderItem(item, index, items.length));
    });

    // Footer
    console.log(`${colors.violet}╰${'─'.repeat(this.maxWidth - 2)}${colors.reset}\n`);
  }

  /**
   * Display a compact inline version (for status updates)
   */
  displayCompact(items: PlanDisplayItem[]): void {
    const completed = items.filter(i => i.status === 'completed').length;
    const inProgress = items.filter(i => i.status === 'in_progress').length;

    const current = items.find(i => i.status === 'in_progress');
    const currentText = current ? `${colors.warning}◉${colors.reset} ${current.content}` : '';

    console.log(
      `${colors.violet}●${colors.reset} ${colors.white}Plan${colors.reset} ${colors.muted}(${completed}/${items.length})${colors.reset} ${currentText}`,
    );
  }

  /**
   * Display a single item update
   */
  displayUpdate(
    item: PlanDisplayItem,
    action: 'added' | 'updated' | 'completed' | 'removed',
  ): void {
    const style = this.getStatusStyle(item.status);
    const actionColor =
      action === 'completed' ? colors.success : action === 'removed' ? colors.error : colors.info;
    const actionIcon =
      action === 'completed' ? '✓' : action === 'removed' ? '✗' : action === 'added' ? '+' : '~';

    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Plan${colors.reset} ${actionColor}${actionIcon}${colors.reset} ${style.color}${style.icon}${colors.reset} ${item.content}`,
    );
    if (action === 'completed') {
      console.log(`  ${colors.success}⎿  Task completed${colors.reset}`);
    } else if (action === 'added') {
      console.log(`  ${colors.info}⎿  Task added to plan${colors.reset}`);
    } else if (action === 'updated') {
      console.log(`  ${colors.info}⎿  Task updated${colors.reset}`);
    } else if (action === 'removed') {
      console.log(`  ${colors.error}⎿  Task removed${colors.reset}`);
    }
  }
}

// Global plan display instance
export const planDisplay = new PlanDisplay();

// Add plan display to step object for easy access
export const planStep = {
  show: (items: PlanDisplayItem[], title?: string) => planDisplay.display(items, title),
  compact: (items: PlanDisplayItem[]) => planDisplay.displayCompact(items),
  add: (item: PlanDisplayItem) => planDisplay.displayUpdate(item, 'added'),
  update: (item: PlanDisplayItem) => planDisplay.displayUpdate(item, 'updated'),
  complete: (item: PlanDisplayItem) => planDisplay.displayUpdate(item, 'completed'),
  remove: (item: PlanDisplayItem) => planDisplay.displayUpdate(item, 'removed'),
};
