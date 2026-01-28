/**
 * Action Parser - Extract actions from LLM response content
 */

import type { Action, GrepAction, ReadAction, EditAction, CreateAction, ExecAction, ScheduleAction, NotifyAction, NotifyService } from './types';

// Regex patterns for each action type
const PATTERNS = {
  grep: /<grep\s+pattern="([^"]+)"(?:\s+file="([^"]+)")?>([^<]*)<\/grep>/g,
  read: /<read\s+path="([^"]+)"(?:\s*\/>|>.*?<\/read>)/g,
  edit: /<edit\s+path="([^"]+)">\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/g,
  create: /<create\s+path="([^"]+)">([\s\S]*?)<\/create>/g,
  exec: /<exec>([^<]+)<\/exec>/g,
  schedule: /<schedule\s+cron="([^"]+)"(?:\s+name="([^"]+)")?(?:\s+notify="([^"]+)")?>([^<]+)<\/schedule>/g,
  notify: /<notify\s+service="([^"]+)">([^<]+)<\/notify>/g,
};

/**
 * Parse all actions from content
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  // Parse grep actions
  let match;
  const grepRegex = new RegExp(PATTERNS.grep.source, 'g');
  while ((match = grepRegex.exec(content)) !== null) {
    const [, pattern, filePattern] = match;
    actions.push({
      type: 'grep',
      pattern,
      filePattern: filePattern || undefined,
    } as GrepAction);
  }

  // Parse read actions
  const readRegex = new RegExp(PATTERNS.read.source, 'g');
  while ((match = readRegex.exec(content)) !== null) {
    const [, path] = match;
    actions.push({
      type: 'read',
      path,
    } as ReadAction);
  }

  // Parse edit actions
  const editRegex = new RegExp(PATTERNS.edit.source, 'g');
  while ((match = editRegex.exec(content)) !== null) {
    const [, path, search, replace] = match;
    actions.push({
      type: 'edit',
      path,
      search: search.trim(),
      replace: replace.trim(),
    } as EditAction);
  }

  // Parse create actions
  const createRegex = new RegExp(PATTERNS.create.source, 'g');
  while ((match = createRegex.exec(content)) !== null) {
    const [, path, fileContent] = match;
    actions.push({
      type: 'create',
      path,
      content: fileContent.trim(),
    } as CreateAction);
  }

  // Parse exec actions
  const execRegex = new RegExp(PATTERNS.exec.source, 'g');
  while ((match = execRegex.exec(content)) !== null) {
    const [, command] = match;
    actions.push({
      type: 'exec',
      command: command.trim(),
    } as ExecAction);
  }

  // Parse schedule actions
  const scheduleRegex = new RegExp(PATTERNS.schedule.source, 'g');
  while ((match = scheduleRegex.exec(content)) !== null) {
    const [, cron, name, notify, command] = match;
    const notifyService = (notify as NotifyService) || 'none';
    actions.push({
      type: 'schedule',
      cron,
      name: name || 'Scheduled Task',
      command: command.trim(),
      notify: notifyService,
    } as ScheduleAction);
  }

  // Parse notify actions
  const notifyRegex = new RegExp(PATTERNS.notify.source, 'g');
  while ((match = notifyRegex.exec(content)) !== null) {
    const [, service, message] = match;
    actions.push({
      type: 'notify',
      service,
      message: message.trim(),
    } as NotifyAction);
  }

  return actions;
}
