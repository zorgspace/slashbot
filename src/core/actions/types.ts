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
  glob?: string;
  caseInsensitive?: boolean;
  lineNumbers?: boolean;
  multiline?: boolean;
  [key: string]: unknown;
}

export type EditStatus = 'applied' | 'no_match' | 'error' | 'not_found' | 'already_applied';

export interface EditResult {
  status: EditStatus;
  path?: string;
  message?: string;
  success?: boolean;
  [key: string]: unknown;
}
