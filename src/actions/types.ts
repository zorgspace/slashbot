/**
 * Action System Type Definitions
 * Aligned with Claude Code tool schema
 */

export type ActionType =
  | 'bash'
  | 'read'
  | 'edit'
  | 'multi-edit'
  | 'write'
  | 'glob'
  | 'grep'
  | 'ls'
  | 'fetch'
  | 'search'
  | 'git'
  | 'format'
  | 'schedule'
  | 'notify'
  | 'skill'
  | 'skill-install'
  | 'task'
  | 'explore'
  // Plan management
  | 'plan'
  // Aliases for backwards compatibility
  | 'exec'
  | 'create';

// ===== Core File Operations =====

export interface ReadAction {
  type: 'read';
  path: string;
  offset?: number; // Line number to start reading from
  limit?: number; // Number of lines to read
}

export interface EditAction {
  type: 'edit';
  path: string;
  search: string;
  replace: string;
  replaceAll?: boolean; // Replace all occurrences (default false)
}

export interface MultiEditAction {
  type: 'multi-edit';
  path: string;
  edits: Array<{
    search: string;
    replace: string;
    replaceAll?: boolean;
  }>;
}

export interface WriteAction {
  type: 'write';
  path: string;
  content: string;
}

// Alias for backwards compatibility
export interface CreateAction {
  type: 'create';
  path: string;
  content: string;
}

// ===== Search & Navigation =====

export interface GlobAction {
  type: 'glob';
  pattern: string;
  path?: string;
}

export interface GrepAction {
  type: 'grep';
  pattern: string;
  path?: string; // File or directory to search in
  glob?: string; // Glob pattern to filter files
  outputMode?: 'content' | 'files_with_matches' | 'count';
  contextBefore?: number; // -B: lines before match
  contextAfter?: number; // -A: lines after match
  context?: number; // -C: lines around match
  caseInsensitive?: boolean; // -i
  lineNumbers?: boolean; // -n
  headLimit?: number; // Limit output lines
  multiline?: boolean; // Enable multiline matching
}

export interface LSAction {
  type: 'ls';
  path: string;
  ignore?: string[]; // Glob patterns to ignore
}

// ===== Shell & Commands =====

export interface BashAction {
  type: 'bash';
  command: string;
  timeout?: number; // Optional timeout in ms
  description?: string;
  runInBackground?: boolean;
}

// Alias for backwards compatibility
export interface ExecAction {
  type: 'exec';
  command: string;
}

// ===== Git Operations =====

export interface GitAction {
  type: 'git';
  command:
    | 'status'
    | 'diff'
    | 'log'
    | 'branch'
    | 'add'
    | 'commit'
    | 'checkout'
    | 'stash'
    | 'push'
    | 'pull';
  args?: string;
}

// ===== Web Operations =====

export interface FetchAction {
  type: 'fetch';
  url: string;
  prompt?: string;
}

export interface SearchAction {
  type: 'search';
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
}

// ===== Code Quality =====

export interface FormatAction {
  type: 'format';
  path?: string;
}

// ===== Scheduling & Notifications =====

export interface ScheduleAction {
  type: 'schedule';
  cron: string;
  name: string;
  command?: string; // Bash command (mutually exclusive with prompt)
  prompt?: string; // LLM prompt for AI-powered tasks (search, fetch, notify, etc.)
}

export interface NotifyAction {
  type: 'notify';
  message: string;
  target?: string;
}

// ===== Skills =====

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

// ===== Sub-task Spawning =====

export interface TaskAction {
  type: 'task';
  prompt: string;
  description?: string;
}

// ===== Parallel Exploration =====

export interface ExploreAction {
  type: 'explore';
  query: string; // What to search for
  path?: string; // Base path to search in (default: src/)
  depth?: 'quick' | 'medium' | 'deep'; // How thorough (default: medium)
}

// ===== Plan Management =====

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  id: string;
  content: string;
  status: PlanItemStatus;
  description?: string;
}

export interface PlanAction {
  type: 'plan';
  operation: 'add' | 'update' | 'complete' | 'remove' | 'show' | 'clear' | 'ask';
  id?: string; // For update/complete/remove operations
  content?: string; // For add operation
  description?: string; // Optional description for the task
  status?: PlanItemStatus; // For update operation
  question?: string; // For ask operation - question to ask the user
}

// ===== Process Management =====

export interface PsAction {
  type: 'ps';
}

export interface KillAction {
  type: 'kill';
  target: string; // Process ID or PID
}

// ===== Connector Configuration =====

export interface TelegramConfigAction {
  type: 'telegram-config';
  botToken: string;
  chatId?: string; // Optional - auto-detect if not provided
}

export interface DiscordConfigAction {
  type: 'discord-config';
  botToken: string;
  channelId: string;
}

// ===== Union Type =====

export type Action =
  | ReadAction
  | EditAction
  | MultiEditAction
  | WriteAction
  | CreateAction
  | GlobAction
  | GrepAction
  | LSAction
  | BashAction
  | ExecAction
  | GitAction
  | FetchAction
  | SearchAction
  | FormatAction
  | ScheduleAction
  | NotifyAction
  | SkillAction
  | SkillInstallAction
  | TaskAction
  | ExploreAction
  | PlanAction
  | PsAction
  | KillAction
  | TelegramConfigAction
  | DiscordConfigAction;

// ===== Results & Options =====

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
}

// ===== Handler Interface =====

export interface ActionHandlers {
  onBash?: (
    command: string,
    options?: { timeout?: number; runInBackground?: boolean },
  ) => Promise<string>;
  onRead?: (path: string, options?: { offset?: number; limit?: number }) => Promise<string | null>;
  onEdit?: (
    path: string,
    search: string,
    replace: string,
    replaceAll?: boolean,
  ) => Promise<EditResult>;
  onMultiEdit?: (
    path: string,
    edits: Array<{ search: string; replace: string; replaceAll?: boolean }>,
  ) => Promise<EditResult>;
  onWrite?: (path: string, content: string) => Promise<boolean>;
  onCreate?: (path: string, content: string) => Promise<boolean>; // Alias
  onFile?: (path: string, content: string) => Promise<boolean>; // Alias
  onGlob?: (pattern: string, basePath?: string) => Promise<string[]>;
  onGrep?: (pattern: string, options?: GrepOptions) => Promise<string>;
  onLS?: (path: string, ignore?: string[]) => Promise<string[]>;
  onGit?: (command: string, args?: string) => Promise<string>;
  onFetch?: (url: string, prompt?: string) => Promise<string>;
  onSearch?: (
    query: string,
    options?: { allowedDomains?: string[]; blockedDomains?: string[] },
  ) => Promise<{ response: string; citations: string[] }>;
  onFormat?: (path?: string) => Promise<string>;
  onSchedule?: (
    cron: string,
    commandOrPrompt: string,
    name: string,
    options?: { isPrompt?: boolean },
  ) => Promise<void>;
  onNotify?: (message: string, target?: string) => Promise<{ sent: string[]; failed: string[] }>;
  onSkill?: (name: string, args?: string) => Promise<string>;
  onSkillInstall?: (url: string, name?: string) => Promise<{ name: string; path: string }>;
  // Sub-task spawning
  onTask?: (prompt: string, description?: string) => Promise<string>;
  // Plan management
  onPlan?: (
    operation: 'add' | 'update' | 'complete' | 'remove' | 'show' | 'clear' | 'ask',
    options?: {
      id?: string;
      content?: string;
      description?: string;
      status?: PlanItemStatus;
      question?: string;
    },
  ) => Promise<{ success: boolean; message: string; plan?: PlanItem[]; question?: string }>;
  // Process management
  onPs?: () => Promise<string>;
  onKill?: (target: string) => Promise<boolean>;
  // Connector configuration
  onTelegramConfig?: (
    botToken: string,
    chatId?: string,
  ) => Promise<{ success: boolean; message: string; chatId?: string }>;
  onDiscordConfig?: (
    botToken: string,
    channelId: string,
  ) => Promise<{ success: boolean; message: string }>;
  // Legacy alias
  onExec?: (command: string) => Promise<string>;
}
