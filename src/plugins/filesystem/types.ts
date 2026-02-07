export interface ReadAction {
  type: 'read';
  path: string;
  offset?: number;
  limit?: number;
}

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export interface EditAction {
  type: 'edit';
  path: string;
  mode: 'full' | 'search-replace';
  content?: string;              // full mode
  blocks?: SearchReplaceBlock[]; // search-replace mode
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
