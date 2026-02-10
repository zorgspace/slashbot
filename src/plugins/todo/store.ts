/**
 * Todo Store - In-memory todo list per session
 */

import type { TodoItem } from './types';

class TodoStore {
  private items: TodoItem[] = [];
  private _lastCompleted: TodoItem[] = [];

  /**
   * Replace the entire todo list (used by todo-write)
   * Tracks which items were newly completed since last update.
   */
  setAll(items: TodoItem[]): void {
    const previousIds = new Map(this.items.map(i => [i.id, i.status]));
    this._lastCompleted = items.filter(
      i => i.status === 'completed' && previousIds.get(i.id) !== 'completed',
    );
    this.items = items.map(item => ({
      ...item,
      updatedAt: Date.now(),
    }));
  }

  /**
   * Get items that were newly completed in the last setAll() call
   */
  getNewlyCompleted(): TodoItem[] {
    return this._lastCompleted;
  }

  /**
   * Get all todos, optionally filtered by status
   */
  getAll(filter?: string): TodoItem[] {
    if (!filter) return [...this.items];
    return this.items.filter(item => item.status === filter);
  }

  /**
   * Get todo progress summary
   */
  getSummary(): { total: number; completed: number; inProgress: number; pending: number } {
    const total = this.items.length;
    const completed = this.items.filter(i => i.status === 'completed').length;
    const inProgress = this.items.filter(i => i.status === 'in_progress').length;
    const pending = this.items.filter(i => i.status === 'pending').length;
    return { total, completed, inProgress, pending };
  }

  /**
   * Clear all todos
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Check if there are any todos
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}

export const todoStore = new TodoStore();
