/**
 * Sticky Plan - Compact inline display near prompt
 */

import { colors } from '../core';
import type { PlanDisplayItem } from './display';

/**
 * Sticky plan display - compact one-liner that stays near the prompt
 * Shows: progress bar, counts, and current task
 */
export class StickyPlan {
  private items: PlanDisplayItem[] = [];
  private visible = false;

  /**
   * Update the plan items
   */
  setItems(items: PlanDisplayItem[]): void {
    this.items = items;
    this.visible = items.length > 0;
  }

  /**
   * Clear the plan
   */
  clear(): void {
    this.items = [];
    this.visible = false;
  }

  /**
   * Check if plan is visible
   */
  isVisible(): boolean {
    return this.visible && this.items.length > 0;
  }

  /**
   * Render the sticky plan line (to be displayed above prompt)
   */
  render(): string {
    if (!this.visible || this.items.length === 0) {
      return '';
    }

    const completed = this.items.filter(i => i.status === 'completed').length;
    const inProgress = this.items.find(i => i.status === 'in_progress');
    const total = this.items.length;

    // Compact progress: ██░░░
    const progressWidth = 5;
    const filled = Math.round((completed / total) * progressWidth);
    const bar = `${colors.success}${'█'.repeat(filled)}${colors.muted}${'░'.repeat(progressWidth - filled)}${colors.reset}`;

    // Current task (short)
    let task = '';
    if (inProgress) {
      const text =
        inProgress.content.length > 35 ? inProgress.content.slice(0, 34) + '…' : inProgress.content;
      task = ` ${colors.warning}◉${colors.reset} ${text}`;
    } else if (completed === total) {
      task = ` ${colors.success}✓${colors.reset}`;
    }

    // Compact: ╭─ ██░░░ 2/6 ◉ Task name
    return `${colors.violet}╭─${colors.reset} ${bar} ${colors.muted}${completed}/${total}${colors.reset}${task}\n`;
  }

  /**
   * Print the sticky plan line
   */
  print(): void {
    const line = this.render();
    if (line) {
      process.stdout.write(line);
    }
  }
}

// Global sticky plan instance
export const stickyPlan = new StickyPlan();
