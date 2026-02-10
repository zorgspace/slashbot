export interface TaskAction {
  type: 'task';
  prompt: string;
  agentType: 'explore' | 'general';
  taskId?: string;
}
