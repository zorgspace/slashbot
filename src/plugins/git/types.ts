export interface GitStatusAction {
  type: 'git-status';
}

export interface GitDiffAction {
  type: 'git-diff';
  ref?: string;
  staged?: boolean;
}

export interface GitLogAction {
  type: 'git-log';
  count?: number;
}

export interface GitCommitAction {
  type: 'git-commit';
  message: string;
  files?: string[];
}
