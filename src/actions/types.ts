/**
 * Action System Type Definitions
 */

export type ActionType = 'grep' | 'read' | 'edit' | 'create' | 'exec' | 'schedule' | 'notify' | 'glob' | 'git' | 'fetch' | 'format' | 'typecheck' | 'search' | 'skill' | 'skill-install';

export interface GrepAction {
  type: 'grep';
  pattern: string;
  filePattern?: string;
  context?: number;        // -C: lines of context around match
  contextBefore?: number;  // -B: lines before match
  contextAfter?: number;   // -A: lines after match
  caseInsensitive?: boolean; // -i: case insensitive search
}

export interface ReadAction {
  type: 'read';
  path: string;
}

export interface EditAction {
  type: 'edit';
  path: string;
  search: string;
  replace: string;
}

export interface CreateAction {
  type: 'create';
  path: string;
  content: string;
}

export interface ExecAction {
  type: 'exec';
  command: string;
}

export interface ScheduleAction {
  type: 'schedule';
  cron: string;
  name: string;
  command: string;
}

export interface NotifyAction {
  type: 'notify';
  message: string;
  target?: string; // Optional: 'telegram', 'discord', or undefined for all
}

export interface GlobAction {
  type: 'glob';
  pattern: string;  // Glob pattern like "**/*.ts", "src/**/*.tsx"
  path?: string;    // Base directory to search from
}

export interface GitAction {
  type: 'git';
  command: 'status' | 'diff' | 'log' | 'branch' | 'add' | 'commit' | 'checkout' | 'stash';
  args?: string;    // Additional arguments (e.g., file path for diff, message for commit)
}

export interface FetchAction {
  type: 'fetch';
  url: string;
  prompt?: string;
}

export interface FormatAction {
  type: 'format';
  path?: string;
}

export interface TypecheckAction {
  type: 'typecheck';
}

export interface SearchAction {
  type: 'search';
  query: string;
  xSearch?: boolean;
}

export interface SkillAction {
  type: 'skill';
  name: string;
  args?: string;
}

export interface SkillInstallAction {
  type: 'skill-install';
  url: string;
  name?: string;
}

export type Action =
  | GrepAction
  | ReadAction
  | EditAction
  | CreateAction
  | ExecAction
  | ScheduleAction
  | NotifyAction
  | GlobAction
  | GitAction
  | FetchAction
  | FormatAction
  | TypecheckAction
  | SearchAction
  | SkillAction
  | SkillInstallAction;

export interface ActionResult {
  action: string;
  success: boolean;
  result: string;
  error?: string;
}

export type EditStatus = 'applied' | 'already_applied' | 'not_found' | 'error';

export interface EditResult {
  success: boolean;
  status: EditStatus;
  message: string;
}

export interface GrepOptions {
  context?: number;
  contextBefore?: number;
  contextAfter?: number;
  caseInsensitive?: boolean;
}

export interface ActionHandlers {
  onGrep?: (pattern: string, filePattern?: string, options?: GrepOptions) => Promise<string>;
  onRead?: (path: string) => Promise<string | null>;
  onEdit?: (path: string, search: string, replace: string) => Promise<EditResult>;
  onCreate?: (path: string, content: string) => Promise<boolean>;
  onExec?: (command: string) => Promise<string>;
  onSchedule?: (cron: string, command: string, name: string) => Promise<void>;
  onFile?: (path: string, content: string) => Promise<boolean>;
  onNotify?: (message: string, target?: string) => Promise<{ sent: string[]; failed: string[] }>;
  onGlob?: (pattern: string, basePath?: string) => Promise<string[]>;
  onGit?: (command: string, args?: string) => Promise<string>;
  onFetch?: (url: string, prompt?: string) => Promise<string>;
  onFormat?: (path?: string) => Promise<string>;
  onTypecheck?: () => Promise<string>;
  onSearch?: (query: string, options?: { xSearch?: boolean }) => Promise<{ response: string; citations: string[] }>;
  onSkill?: (name: string, args?: string) => Promise<string>;
  onSkillInstall?: (url: string, name?: string) => Promise<{ name: string; path: string }>;
}
