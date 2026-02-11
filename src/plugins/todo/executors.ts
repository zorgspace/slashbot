import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { TodoWriteAction, TodoReadAction } from './types';
import { todoStore } from './store';
import { display, formatToolAction } from '../../core/ui';

/** Optional callback for push-notifying completed todos to connectors */
let notifyCallback: ((message: string, target?: string) => Promise<void>) | null = null;

export function setTodoNotifyCallback(cb: typeof notifyCallback): void {
  notifyCallback = cb;
}

export async function executeTodoWrite(
  action: TodoWriteAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  todoStore.setAll(action.todos);
  const summary = todoStore.getSummary();

  // Update persistent task list panel above input
  display.updateNotificationList(
    action.todos.map(i => ({ id: i.id, content: i.content, status: i.status })),
  );

  // Flash notification + push to connectors for newly completed todos
  const newlyCompleted = todoStore.getNewlyCompleted();
  for (const todo of newlyCompleted) {
    display.showNotification(todo.content);
    if (todo.notifyTarget && notifyCallback) {
      notifyCallback(`\u2713 Todo completed: ${todo.content}`, todo.notifyTarget).catch(() => {});
    }
  }

  const formatted = action.todos
    .map(t => {
      const icon =
        t.status === 'completed' ? '\u2713' : t.status === 'in_progress' ? '\u25B6' : '\u25CB';
      return `${icon} [${t.id}] ${t.content}`;
    })
    .join('\n');

  return {
    action: 'TodoWrite',
    success: true,
    result: `Todo list updated:\n${formatted}`,
  };
}

export async function executeTodoRead(
  action: TodoReadAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const todos = todoStore.getAll(action.filter);

  display.appendAssistantMessage(
    formatToolAction('TodoRead', action.filter ? `filter: ${action.filter}` : 'all', {
      success: true,
      summary: `${todos.length} items`,
    }),
  );

  if (todos.length === 0) {
    return {
      action: 'TodoRead',
      success: true,
      result: 'No todos found.',
    };
  }

  const formatted = todos
    .map(t => {
      const icon =
        t.status === 'completed' ? '\u2713' : t.status === 'in_progress' ? '\u25B6' : '\u25CB';
      return `${icon} [${t.id}] (${t.status}) ${t.content}`;
    })
    .join('\n');

  return {
    action: 'TodoRead',
    success: true,
    result: formatted,
  };
}
