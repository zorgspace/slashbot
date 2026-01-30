/**
 * Action Parser - Extract actions from LLM response content
 *
 * Uses [[action ...]]...[[/action]] syntax to avoid false positives
 * from XML-like patterns appearing in code examples or documentation.
 */

import type { Action, GrepAction, ReadAction, EditAction, CreateAction, ExecAction, ScheduleAction, SkillAction, NotifyAction, WebAction, FetchAction } from './types';

// Quote pattern: matches both single and double quotes
const Q = `["']`;  // quote
const NQ = `[^"']*`;  // non-quote content (allow empty)
const NQR = `[^"']+`;  // non-quote content (required - at least 1 char)

// Flexible attribute extractor - handles any order and whitespace
function extractAttr(tag: string, name: string): string | null {
  // Try quoted: attr="value" or attr='value'
  const quotedMatch = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  if (quotedMatch) return quotedMatch[1];
  // Try unquoted: attr=value (word chars only)
  const unquotedMatch = tag.match(new RegExp(`${name}\\s*=\\s*(\\S+)`, 'i'));
  if (unquotedMatch) return unquotedMatch[1];
  return null;
}

// Regex patterns for each action type using [[action]] syntax
// This is less likely to appear in normal text/code than XML-like <action> tags
const PATTERNS = {
  // [[grep ...]]...[[/grep]] - flexible attribute extraction
  grep: /\[\[grep\s+[^\]]*\]\]([\s\S]*?)\[\[\/grep\]\]/gi,
  // [[read path="..."/]] or [[read path="..."]] or [[read path="..."]]...[[/read]]
  read: /\[\[read\s+[^\]]*\/?\]\](?:[\s\S]*?\[\[\/read\]\])?/gi,
  // [[edit path="..."]][[search]]...[[/search]][[replace]]...[[/replace]][[/edit]]
  edit: new RegExp(`\\[\\[edit\\s+path=${Q}(${NQR})${Q}\\s*\\]\\]\\s*\\[\\[search\\]\\]([\\s\\S]*?)\\[\\[/search\\]\\]\\s*\\[\\[replace\\]\\]([\\s\\S]*?)\\[\\[/replace\\]\\]\\s*\\[\\[/edit\\]\\]`, 'gi'),
  // [[create path="..."]]...[[/create]]
  create: new RegExp(`\\[\\[create\\s+path=${Q}(${NQR})${Q}\\s*\\]\\]([\\s\\S]*?)\\[\\[/create\\]\\]`, 'gi'),
  // [[exec]]...[[/exec]]
  exec: /\[\[exec\s*\]\]([\s\S]+?)\[\[\/exec\]\]/gi,
  // [[schedule cron="..." name="..."]]...[[/schedule]] (name optional)
  schedule: new RegExp(`\\[\\[schedule\\s+cron=${Q}(${NQR})${Q}(?:\\s+name=${Q}(${NQ})${Q})?\\s*\\]\\]([\\s\\S]+?)\\[\\[/schedule\\]\\]`, 'gi'),
  // [[skill name="..."/]] or [[skill name="..."]]
  skill: new RegExp(`\\[\\[skill\\s+name=${Q}(${NQR})${Q}\\s*/?\\]\\]`, 'gi'),
  // [[notify]]message[[/notify]] or [[notify to="telegram"]]message[[/notify]]
  notify: /\[\[notify(?:\s+to=["']([^"']+)["'])?\s*\]\]([\s\S]+?)\[\[\/notify\]\]/gi,
  // [[web]]query[[/web]]
  web: /\[\[web\s*\]\]([\s\S]+?)\[\[\/web\]\]/gi,
  // [[fetch url="..."]] or [[fetch]]url[[/fetch]]
  fetch: /\[\[fetch(?:\s+url=["']([^"']+)["'])?\s*\]\](?:([\s\S]*?)\[\[\/fetch\]\])?/gi,
};

/**
 * Parse all actions from content
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  // Parse grep actions (flexible attribute extraction)
  let match;
  const grepRegex = new RegExp(PATTERNS.grep.source, 'gi');
  while ((match = grepRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const pattern = extractAttr(fullTag, 'pattern');
    const filePattern = extractAttr(fullTag, 'file');
    if (pattern) {
      actions.push({
        type: 'grep',
        pattern,
        filePattern: filePattern || undefined,
      } as GrepAction);
    }
  }

  // Parse read actions (flexible attribute extraction)
  const readRegex = new RegExp(PATTERNS.read.source, 'gi');
  while ((match = readRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const path = extractAttr(fullTag, 'path');
    if (path) {
      actions.push({
        type: 'read',
        path,
      } as ReadAction);
    }
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
    const [, cron, name, command] = match;
    actions.push({
      type: 'schedule',
      cron,
      name: name || 'Scheduled Task',
      command: command.trim(),
    } as ScheduleAction);
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

  // Parse notify actions
  const notifyRegex = new RegExp(PATTERNS.notify.source, 'gi');
  while ((match = notifyRegex.exec(content)) !== null) {
    const [, target, message] = match;
    actions.push({
      type: 'notify',
      message: message.trim(),
      target: target || undefined,
    } as NotifyAction);
  }

  // Parse web search actions
  const webRegex = new RegExp(PATTERNS.web.source, 'gi');
  while ((match = webRegex.exec(content)) !== null) {
    const [, query] = match;
    actions.push({
      type: 'web',
      query: query.trim(),
    } as WebAction);
  }

  // Parse fetch actions
  const fetchRegex = new RegExp(PATTERNS.fetch.source, 'gi');
  while ((match = fetchRegex.exec(content)) !== null) {
    const [, urlAttr, urlContent] = match;
    const url = urlAttr || (urlContent ? urlContent.trim() : '');
    if (url) {
      actions.push({
        type: 'fetch',
        url,
      } as FetchAction);
    }
  }

  return actions;
}
