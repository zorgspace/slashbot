export interface ReadAction {
  type: 'read';
  path: string;
  offset?: number;
  limit?: number;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

export interface DiffHunk {
  startLine: number;
  lineCount: number;
  diffLines: DiffLine[];
}

export interface EditAction {
  type: 'edit';
  path: string;
  hunks: DiffHunk[];
}

export interface WriteAction {
  type: 'write';
  path: string;
  content: string;
}

export interface CreateAction {
  type: 'create';
  path: string;
  content: string;
}
