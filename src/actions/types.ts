/**
 * Action System Type Definitions
 */

export type ActionType = 'grep' | 'read' | 'edit' | 'create' | 'exec' | 'schedule' | 'skill' | 'notify';

export interface GrepAction {
  type: 'grep';
  pattern: string;
  filePattern?: string;
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

export interface SkillAction {
  type: 'skill';
  name: string;
}

export interface NotifyAction {
  type: 'notify';
  message: string;
  target?: string; // Optional: 'telegram', 'discord', or undefined for all
}

export type Action =
  | GrepAction
  | ReadAction
  | EditAction
  | CreateAction
  | ExecAction
  | ScheduleAction
  | SkillAction
  | NotifyAction;

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

export interface ActionHandlers {
  onGrep?: (pattern: string, filePattern?: string) => Promise<string>;
  onRead?: (path: string) => Promise<string | null>;
  onEdit?: (path: string, search: string, replace: string) => Promise<EditResult>;
  onCreate?: (path: string, content: string) => Promise<boolean>;
  onExec?: (command: string) => Promise<string>;
  onSchedule?: (cron: string, command: string, name: string) => Promise<void>;
  onSkill?: (name: string) => Promise<string>;
  onFile?: (path: string, content: string) => Promise<boolean>;
  onNotify?: (message: string, target?: string) => Promise<{ sent: string[]; failed: string[] }>;
}
