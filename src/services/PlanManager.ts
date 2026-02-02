/**
 * Plan Manager - Manages LLM task tracking and plan state
 */

import 'reflect-metadata';
import { injectable } from 'inversify';
import type { PlanItem, PlanItemStatus } from '../actions/types';

export interface PlanOperationResult {
  success: boolean;
  message: string;
  plan?: PlanItem[];
  question?: string;
}

@injectable()
export class PlanManager {
  private items: PlanItem[] = [];
  private idCounter = 0;

  /**
   * Get all plan items
   */
  getItems(): PlanItem[] {
    return [...this.items];
  }

  /**
   * Execute a plan operation
   */
  execute(
    operation: string,
    options?: {
      id?: string;
      content?: string;
      description?: string;
      status?: PlanItemStatus;
      question?: string;
    },
  ): PlanOperationResult {
    switch (operation) {
      case 'add': {
        if (!options?.content) {
          return { success: false, message: 'Content required for add operation' };
        }
        const newItem: PlanItem = {
          id: `plan-${++this.idCounter}`,
          content: options.content,
          status: 'pending',
          description: options.description,
        };
        this.items.push(newItem);
        return {
          success: true,
          message: `Added task: ${options.content}`,
          plan: this.items,
        };
      }

      case 'update': {
        if (!options?.id) {
          return { success: false, message: 'ID required for update operation' };
        }
        const item = this.items.find(i => i.id === options.id);
        if (!item) {
          return { success: false, message: `Task not found: ${options.id}` };
        }
        if (options.status) item.status = options.status;
        if (options.content) item.content = options.content;
        if (options.description) item.description = options.description;
        return {
          success: true,
          message: `Updated task: ${item.content}`,
          plan: this.items,
        };
      }

      case 'complete': {
        if (!options?.id) {
          return { success: false, message: 'ID required for complete operation' };
        }
        const item = this.items.find(i => i.id === options.id);
        if (!item) {
          return { success: false, message: `Task not found: ${options.id}` };
        }
        item.status = 'completed';
        return {
          success: true,
          message: `Completed task: ${item.content}`,
          plan: this.items,
        };
      }

      case 'remove': {
        if (!options?.id) {
          return { success: false, message: 'ID required for remove operation' };
        }
        const idx = this.items.findIndex(i => i.id === options.id);
        if (idx === -1) {
          return { success: false, message: `Task not found: ${options.id}` };
        }
        const removed = this.items.splice(idx, 1)[0];
        return {
          success: true,
          message: `Removed task: ${removed.content}`,
          plan: this.items,
        };
      }

      case 'show': {
        return {
          success: true,
          message: `Showing ${this.items.length} task(s)`,
          plan: this.items,
        };
      }

      case 'clear': {
        this.items = [];
        this.idCounter = 0;
        return {
          success: true,
          message: 'Plan cleared',
          plan: [],
        };
      }

      case 'ask': {
        if (!options?.question) {
          return { success: false, message: 'Question required for ask operation' };
        }
        return {
          success: true,
          message: 'Question asked',
          plan: this.items,
          question: options.question,
        };
      }

      default:
        return { success: false, message: `Unknown operation: ${operation}` };
    }
  }
}
