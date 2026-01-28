/**
 * Action System Type Definitions
 */

export type ActionType = 'grep' | 'read' | 'edit' | 'create' | 'exec' | 'schedule' | 'notify' | 'skill';

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

export type NotifyService = 'telegram' | 'whatsapp' | 'all' | 'none';

export interface ScheduleAction {
  type: 'schedule';
  cron: string;
  name: string;
  command: string;
  notify?: NotifyService;
}

export interface SkillAction {
  type: 'skill';
  name: string;
}

export interface NotifyAction {
  type: 'notify';
  service: string;
  message: string;
}

export type Action =
  | GrepAction
  | ReadAction
  | EditAction
  | CreateAction
  | ExecAction
  | ScheduleAction
  | NotifyAction
  | SkillAction;

export interface ActionResult {
  action: string;
  success: boolean;
  result: string;
  error?: string;
}

export interface ActionHandlers {
  onGrep?: (pattern: string, filePattern?: string) => Promise<string>;
  onRead?: (path: string) => Promise<string | null>;
  onEdit?: (path: string, search: string, replace: string) => Promise<boolean>;
  onCreate?: (path: string, content: string) => Promise<boolean>;
  onExec?: (command: string) => Promise<string>;
  onSchedule?: (cron: string, command: string, name: string, notify?: NotifyService) => Promise<void>;
  onNotify?: (service: string, message: string) => Promise<void>;
  onSkill?: (name: string) => Promise<string>;
  onFile?: (path: string, content: string) => Promise<boolean>;
  onBuildCheck?: () => Promise<{ success: boolean; errors: string[] }>;
}
