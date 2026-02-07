export interface BashAction {
  type: 'bash';
  command: string;
  timeout?: number;
  description?: string;
  runInBackground?: boolean;
}

export interface ExecAction {
  type: 'exec';
  command: string;
}
