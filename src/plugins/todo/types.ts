export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
  updatedAt: number;
}

export interface TodoWriteAction {
  type: 'todo-write';
  todos: TodoItem[];
}

export interface TodoReadAction {
  type: 'todo-read';
  filter?: string;
}
