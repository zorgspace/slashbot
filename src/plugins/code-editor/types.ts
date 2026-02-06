export interface GlobAction {
  type: 'glob';
  pattern: string;
  path?: string;
}

export interface GrepAction {
  type: 'grep';
  pattern: string;
  path?: string;
  glob?: string;
  outputMode?: 'content' | 'files_with_matches' | 'count';
  contextBefore?: number;
  contextAfter?: number;
  context?: number;
  caseInsensitive?: boolean;
  lineNumbers?: boolean;
  headLimit?: number;
  multiline?: boolean;
}

export interface LSAction {
  type: 'ls';
  path: string;
  ignore?: string[];
}

export interface FormatAction {
  type: 'format';
  path?: string;
}
