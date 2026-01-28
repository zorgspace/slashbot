/**
 * Action Parser - Extract actions from LLM response content
 */

import type { Action, GrepAction, ReadAction, EditAction, CreateAction, ExecAction, ScheduleAction, NotifyAction, SkillAction, NotifyService } from './types';

// Quote pattern: matches both single and double quotes
const Q = `["']`;  // quote
const NQ = `[^"']+`;  // non-quote content

// Regex patterns for each action type (flexible with quotes and whitespace)
const PATTERNS = {
  // <grep pattern="..." file="...">...</grep> (file is optional, attributes can be in any order)
  grep: new RegExp(`<grep\\s+(?:pattern=${Q}(${NQ})${Q}(?:\\s+file=${Q}(${NQ})${Q})?|file=${Q}(${NQ})${Q}\\s+pattern=${Q}(${NQ})${Q})\\s*>([\\s\\S]*?)</grep>`, 'gi'),
  // <read path="..."/> or <read path="...">...</read>
  read: new RegExp(`<read\\s+path=${Q}(${NQ})${Q}\\s*(?:/>|>[\\s\\S]*?</read>)`, 'gi'),
  // <edit path="..."><search>...</search><replace>...</replace></edit>
  edit: new RegExp(`<edit\\s+path=${Q}(${NQ})${Q}\\s*>\\s*<search>([\\s\\S]*?)</search>\\s*<replace>([\\s\\S]*?)</replace>\\s*</edit>`, 'gi'),
  // <create path="...">...</create>
  create: new RegExp(`<create\\s+path=${Q}(${NQ})${Q}\\s*>([\\s\\S]*?)</create>`, 'gi'),
  // <exec>...</exec>
  exec: /<exec\s*>([\s\S]+?)<\/exec>/gi,
  // <schedule cron="..." name="..." notify="...">...</schedule> (name and notify optional)
  schedule: new RegExp(`<schedule\\s+cron=${Q}(${NQ})${Q}(?:\\s+name=${Q}(${NQ})${Q})?(?:\\s+notify=${Q}(${NQ})${Q})?\\s*>([\\s\\S]+?)</schedule>`, 'gi'),
  // <notify service="...">...</notify>
  notify: new RegExp(`<notify\\s+service=${Q}(${NQ})${Q}\\s*>([\\s\\S]+?)</notify>`, 'gi'),
  // <skill name="..."/> or <skill name="...">
  skill: new RegExp(`<skill\\s+name=${Q}(${NQ})${Q}\\s*/?>`, 'gi'),
};

/**
 * Parse all actions from content
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  // Parse grep actions (handles attributes in any order)
  let match;
  const grepRegex = new RegExp(PATTERNS.grep.source, 'gi');
  while ((match = grepRegex.exec(content)) !== null) {
    // Groups: [1]=pattern (order1), [2]=file (order1), [3]=file (order2), [4]=pattern (order2), [5]=content
    const pattern = match[1] || match[4];
    const filePattern = match[2] || match[3];
    if (pattern) {
      actions.push({
        type: 'grep',
        pattern,
        filePattern: filePattern || undefined,
      } as GrepAction);
    }
  }

  // Parse read actions
  const readRegex = new RegExp(PATTERNS.read.source, 'gi');
  while ((match = readRegex.exec(content)) !== null) {
    const [, path] = match;
    actions.push({
      type: 'read',
      path,
    } as ReadAction);
  }

  // Parse edit actions
  const editRegex = new RegExp(PATTERNS.edit.source, 'gi');
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
  const createRegex = new RegExp(PATTERNS.create.source, 'gi');
  while ((match = createRegex.exec(content)) !== null) {
    const [, path, fileContent] = match;
    actions.push({
      type: 'create',
      path,
      content: fileContent.trim(),
    } as CreateAction);
  }

  // Parse exec actions
  const execRegex = new RegExp(PATTERNS.exec.source, 'gi');
  while ((match = execRegex.exec(content)) !== null) {
    const [, command] = match;
    actions.push({
      type: 'exec',
      command: command.trim(),
    } as ExecAction);
  }

  // Parse schedule actions
  const scheduleRegex = new RegExp(PATTERNS.schedule.source, 'gi');
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
  const notifyRegex = new RegExp(PATTERNS.notify.source, 'gi');
  while ((match = notifyRegex.exec(content)) !== null) {
    const [, service, message] = match;
    actions.push({
      type: 'notify',
      service,
      message: message.trim(),
    } as NotifyAction);
  }

  // Parse skill actions
  const skillRegex = new RegExp(PATTERNS.skill.source, 'gi');
  while ((match = skillRegex.exec(content)) !== null) {
    const [, name] = match;
    actions.push({
      type: 'skill',
      name,
    } as SkillAction);
  }

  return actions;
}
