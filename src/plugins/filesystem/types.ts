export interface ReadAction {
  type: 'read';
  path: string;
  offset?: number;
  limit?: number;
}

export interface EditAction {
  type: 'edit';
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
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
