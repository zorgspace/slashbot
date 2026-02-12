export type Action = {
  type: string;
  [key: string]: unknown;
};

export type ActionResult = {
  result: string;
  action?: string;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
};

export interface ActionHandlers {
  [key: string]: Function;
}

export interface GrepOptions {
  path?: string;
  glob?: string;
  outputMode?: 'content' | 'files_with_matches' | 'count';
  context?: number;
  contextBefore?: number;
  contextAfter?: number;
  caseInsensitive?: boolean;
  lineNumbers?: boolean;
  headLimit?: number;
  multiline?: boolean;
  [key: string]: unknown;
}

export type EditStatus = 'applied' | 'no_match' | 'error' | 'not_found' | 'already_applied';

export interface EditResult {
  status: EditStatus;
  path?: string;
  message?: string;
  success?: boolean;
  beforeContent?: string;
  afterContent?: string;
  [key: string]: unknown;
}
