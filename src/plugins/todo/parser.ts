import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getTodoParserConfigs(): ActionParserConfig[] {
  return [
    // todo-write: set the entire todo list
    {
      tags: ['todo-write'],
      preStrip: true,
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<todo-write\s*>([\s\S]*?)<\/todo-write>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const inner = match[1];
          // Parse individual <todo> items (with optional notify attribute)
          const todoRegex = /<todo\s+[^>]*>([\s\S]*?)<\/todo>/gi;
          const todos: any[] = [];
          let todoMatch;
          while ((todoMatch = todoRegex.exec(inner)) !== null) {
            const fullTag = todoMatch[0];
            const id = extractAttr(fullTag, 'id');
            const status = extractAttr(fullTag, 'status');
            const notify = extractAttr(fullTag, 'notify');
            if (id && status) {
              todos.push({
                id,
                status,
                content: todoMatch[1].trim(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                notifyTarget: notify || undefined,
              });
            }
          }
          if (todos.length > 0) {
            actions.push({ type: 'todo-write', todos } as Action);
          }
        }
        return actions;
      },
    },
    // todo-read: read the current todo list
    {
      tags: ['todo-read'],
      selfClosingTags: ['todo-read'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<todo-read\s*[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const filter = extractAttr(fullTag, 'filter');
          actions.push({ type: 'todo-read', filter: filter || undefined } as Action);
        }
        return actions;
      },
    },
  ];
}
