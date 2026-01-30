/**
 * Action Parser - Extract actions from LLM response content
 *
 * Uses [[action ...]]...[[/action]] syntax to avoid false positives
 * from XML-like patterns appearing in code examples or documentation.
 */

import type { Action, GrepAction, ReadAction, EditAction, CreateAction, ExecAction, ScheduleAction, NotifyAction, GlobAction, GitAction, FetchAction, FormatAction, TypecheckAction, SearchAction, SkillAction, SkillInstallAction } from './types';

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
  // [[notify]]message[[/notify]] or [[notify to="telegram"]]message[[/notify]]
  notify: /\[\[notify(?:\s+to=["']([^"']+)["'])?\s*\]\]([\s\S]+?)\[\[\/notify\]\]/gi,
  // [[glob pattern="**/*.ts"/]] or [[glob pattern="**/*.ts" path="src"/]]
  glob: /\[\[glob\s+[^\]]*\/?\]\]/gi,
  // [[git command="status"/]] or [[git command="diff" args="--staged"/]]
  git: /\[\[git\s+[^\]]*\/?\]\]/gi,
  // [[fetch url="https://..."/]] or [[fetch url="..." prompt="..."/]]
  fetch: /\[\[fetch\s+[^\]]*\/?\]\]/gi,
  // [[format/]] or [[format path="..."/]]
  format: /\[\[format(?:\s+[^\]]*)?\s*\/?\]\]/gi,
  // [[typecheck/]]
  typecheck: /\[\[typecheck\s*\/?\]\]/gi,
  // [[search query="..."/]] or [[search query="..." x="true"/]]
  search: /\[\[search\s+[^\]]*\/?\]\]/gi,
  // [[skill name="..."/]] or [[skill name="..." args="..."/]]
  skill: /\[\[skill\s+[^\]]*\/?\]\]/gi,
  // [[skill-install url="..."/]] or [[skill-install url="..." name="..."/]]
  skillInstall: /\[\[skill-install\s+[^\]]*\/?\]\]/gi,
};

/**
 * Remove code blocks from content to prevent parsing actions inside them
 * This prevents injection when AI outputs documentation/examples
 */
function stripCodeBlocks(content: string): string {
  // Remove fenced code blocks (```...```)
  let result = content.replace(/```[\s\S]*?```/g, '');
  // Remove inline code (`...`)
  result = result.replace(/`[^`]+`/g, '');
  // Remove [[literal]]...[[/literal]] blocks (explicit no-execute)
  result = result.replace(/\[\[literal\]\][\s\S]*?\[\[\/literal\]\]/gi, '');
  return result;
}

/**
 * Parse all actions from content
 * Actions inside code blocks are ignored to prevent injection
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  // Strip code blocks to prevent parsing actions inside them
  const safeContent = stripCodeBlocks(content);

  // Parse grep actions (flexible attribute extraction with context options)
  let match;
  const grepRegex = new RegExp(PATTERNS.grep.source, 'gi');
  while ((match = grepRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const pattern = extractAttr(fullTag, 'pattern');
    const filePattern = extractAttr(fullTag, 'file');
    const context = extractAttr(fullTag, 'context');
    const contextBefore = extractAttr(fullTag, 'before');
    const contextAfter = extractAttr(fullTag, 'after');
    const caseInsensitive = extractAttr(fullTag, 'case');
    if (pattern) {
      actions.push({
        type: 'grep',
        pattern,
        filePattern: filePattern || undefined,
        context: context ? parseInt(context, 10) : undefined,
        contextBefore: contextBefore ? parseInt(contextBefore, 10) : undefined,
        contextAfter: contextAfter ? parseInt(contextAfter, 10) : undefined,
        caseInsensitive: caseInsensitive === 'insensitive' || caseInsensitive === 'i',
      } as GrepAction);
    }
  }

  // Parse read actions (flexible attribute extraction)
  const readRegex = new RegExp(PATTERNS.read.source, 'gi');
  while ((match = readRegex.exec(safeContent)) !== null) {
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
  while ((match = editRegex.exec(safeContent)) !== null) {
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
  while ((match = createRegex.exec(safeContent)) !== null) {
    const [, path, fileContent] = match;
    actions.push({
      type: 'create',
      path,
      content: fileContent.trim(),
    } as CreateAction);
  }

  // Parse exec actions
  const execRegex = new RegExp(PATTERNS.exec.source, 'gi');
  while ((match = execRegex.exec(safeContent)) !== null) {
    const [, command] = match;
    actions.push({
      type: 'exec',
      command: command.trim(),
    } as ExecAction);
  }

  // Parse schedule actions
  const scheduleRegex = new RegExp(PATTERNS.schedule.source, 'gi');
  while ((match = scheduleRegex.exec(safeContent)) !== null) {
    const [, cron, name, command] = match;
    actions.push({
      type: 'schedule',
      cron,
      name: name || 'Scheduled Task',
      command: command.trim(),
    } as ScheduleAction);
  }

  // Parse notify actions
  const notifyRegex = new RegExp(PATTERNS.notify.source, 'gi');
  while ((match = notifyRegex.exec(safeContent)) !== null) {
    const [, target, message] = match;
    actions.push({
      type: 'notify',
      message: message.trim(),
      target: target || undefined,
    } as NotifyAction);
  }

  // Parse glob actions (flexible attribute extraction)
  const globRegex = new RegExp(PATTERNS.glob.source, 'gi');
  while ((match = globRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const pattern = extractAttr(fullTag, 'pattern');
    const basePath = extractAttr(fullTag, 'path');
    if (pattern) {
      actions.push({
        type: 'glob',
        pattern,
        path: basePath || undefined,
      } as GlobAction);
    }
  }

  // Parse git actions (flexible attribute extraction)
  const gitRegex = new RegExp(PATTERNS.git.source, 'gi');
  while ((match = gitRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const command = extractAttr(fullTag, 'command');
    const args = extractAttr(fullTag, 'args');
    if (command && ['status', 'diff', 'log', 'branch', 'add', 'commit', 'checkout', 'stash'].includes(command)) {
      actions.push({
        type: 'git',
        command: command as GitAction['command'],
        args: args || undefined,
      } as GitAction);
    }
  }

  // Parse fetch actions (flexible attribute extraction)
  const fetchRegex = new RegExp(PATTERNS.fetch.source, 'gi');
  while ((match = fetchRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const url = extractAttr(fullTag, 'url');
    const prompt = extractAttr(fullTag, 'prompt');
    if (url) {
      actions.push({
        type: 'fetch',
        url,
        prompt: prompt || undefined,
      } as FetchAction);
    }
  }

  // Parse format actions
  const formatRegex = new RegExp(PATTERNS.format.source, 'gi');
  while ((match = formatRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const path = extractAttr(fullTag, 'path');
    actions.push({
      type: 'format',
      path: path || undefined,
    } as FormatAction);
  }

  // Parse typecheck actions
  const typecheckRegex = new RegExp(PATTERNS.typecheck.source, 'gi');
  while ((match = typecheckRegex.exec(safeContent)) !== null) {
    actions.push({
      type: 'typecheck',
    } as TypecheckAction);
  }

  // Parse search actions
  const searchRegex = new RegExp(PATTERNS.search.source, 'gi');
  while ((match = searchRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const query = extractAttr(fullTag, 'query');
    const xSearch = extractAttr(fullTag, 'x');
    if (query) {
      actions.push({
        type: 'search',
        query,
        xSearch: xSearch === 'true',
      } as SearchAction);
    }
  }

  // Parse skill actions
  const skillRegex = new RegExp(PATTERNS.skill.source, 'gi');
  while ((match = skillRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const name = extractAttr(fullTag, 'name');
    const args = extractAttr(fullTag, 'args');
    if (name) {
      actions.push({
        type: 'skill',
        name,
        args: args || undefined,
      } as SkillAction);
    }
  }

  // Parse skill-install actions
  const skillInstallRegex = new RegExp(PATTERNS.skillInstall.source, 'gi');
  while ((match = skillInstallRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const url = extractAttr(fullTag, 'url');
    const name = extractAttr(fullTag, 'name');
    if (url) {
      actions.push({
        type: 'skill-install',
        url,
        name: name || undefined,
      } as SkillInstallAction);
    }
  }

  return actions;
}
