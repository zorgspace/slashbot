/**
 * Action Parser - Extract actions from LLM response content
 *
 * Uses <action ...>...</action> XML syntax for better LLM compatibility.
 * Actions inside code blocks are stripped to prevent injection.
 * Aligned with Claude Code tool schema.
 */

import type {
  Action,
  BashAction,
  ReadAction,
  EditAction,
  MultiEditAction,
  WriteAction,
  CreateAction,
  GlobAction,
  GrepAction,
  LSAction,
  GitAction,
  FetchAction,
  SearchAction,
  FormatAction,
  TypecheckAction,
  ScheduleAction,
  NotifyAction,
  SkillAction,
  SkillInstallAction,
  TaskAction,
  PlanAction,
  PlanItemStatus,
  ExecAction,
  PsAction,
  KillAction,
} from './types';

// Quote pattern: matches both single and double quotes
const Q = `["']`; // quote
const NQ = `[^"']*`; // non-quote content (allow empty)
const NQR = `[^"']+`; // non-quote content (required - at least 1 char)

// Fix truncated/malformed tags (LLM sometimes makes mistakes)
function fixTruncatedTags(content: string): string {
  let result = content;

  // List of action tags that might be truncated
  const tags = [
    'bash',
    'read',
    'edit',
    'multi-edit',
    'write',
    'create',
    'exec',
    'glob',
    'grep',
    'ls',
    'git',
    'fetch',
    'search',
    'format',
    'typecheck',
    'schedule',
    'notify',
    'skill',
    'skill-install',
    'task',
    'plan',
    'ps',
    'kill',
    'replace',
  ]; // include inner tags too

  // Fix malformed inner tags like <search"> or <replace"> (stray quotes)
  result = result.replace(/<search["'\s]*>/gi, '<search>');
  result = result.replace(/<replace["'\s]*>/gi, '<replace>');
  result = result.replace(/<\/search["'\s]*>/gi, '</search>');
  result = result.replace(/<\/replace["'\s]*>/gi, '</replace>');

  // Fix truncated closing tags like </edit (missing >) - ANYWHERE in content, not just end
  for (const tag of tags) {
    // Fix </tag followed by newline or other content (missing >)
    // Match </tag NOT followed by > but followed by newline, space, or end
    const truncatedClosePattern = new RegExp(`</${tag}(?=[\\s\\n]|$)(?!>)`, 'gi');
    result = result.replace(truncatedClosePattern, `</${tag}>`);

    // Also fix </tag at very end of content
    const truncatedCloseEnd = new RegExp(`</${tag}\\s*$`, 'i');
    result = result.replace(truncatedCloseEnd, `</${tag}>`);
  }

  // Fix </ at very end (incomplete closing tag)
  result = result.replace(/<\/\s*$/, '');

  // Fix truncated self-closing tags like <read path="x" or <read path="x"/
  for (const tag of tags) {
    // Match opening tag without proper closing at end of string
    const truncatedSelfClose = new RegExp(`(<${tag}\\s+[^>]*?)\\s*$`, 'i');
    const match = result.match(truncatedSelfClose);
    if (match && !match[1].endsWith('/>') && !match[1].endsWith('>')) {
      result = result.replace(truncatedSelfClose, `$1/>`);
    }
  }

  return result;
}

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

// Check if attribute is truthy
function extractBoolAttr(tag: string, name: string): boolean {
  const val = extractAttr(tag, name);
  return val === 'true' || val === '1' || val === 'yes';
}

// Regex patterns for each action type using XML <action> syntax
const PATTERNS = {
  // ===== Shell Commands =====
  // <bash>command</bash> or <bash timeout="5000">command</bash>
  bash: /<bash(?:\s+[^>]*)?\s*>([\s\S]+?)<\/bash>/gi,
  // <exec>command</exec> (legacy alias)
  exec: /<exec\s*>([\s\S]+?)<\/exec>/gi,

  // ===== File Operations =====
  // <read path="..." /> or <read path="..." offset="10" limit="50"/>
  read: /<read\s+[^>]*\/?>/gi,
  // <edit path="..."><search>...</search><replace>...</replace></edit>
  edit: new RegExp(
    `<edit\\s+path=${Q}(${NQR})${Q}[^>]*>\\s*<search>([\\s\\S]*?)</search>\\s*<replace>([\\s\\S]*?)</replace>\\s*</edit>`,
    'gi',
  ),
  // <multi-edit path="..."><edit><search>...</search><replace>...</replace></edit>...</multi-edit>
  multiEdit: /<multi-edit\s+path=["']([^"']+)["'][^>]*>([\s\S]*?)<\/multi-edit>/gi,
  // <write path="...">content</write>
  write: new RegExp(`<write\\s+path=${Q}(${NQR})${Q}\\s*>([\\s\\S]*?)</write>`, 'gi'),
  // <create path="...">content</create> (legacy alias)
  create: new RegExp(`<create\\s+path=${Q}(${NQR})${Q}\\s*>([\\s\\S]*?)</create>`, 'gi'),

  // ===== Search & Navigation =====
  // <glob pattern="**/*.ts"/> or <glob pattern="..." path="src"/>
  glob: /<glob\s+[^>]*\/?>/gi,
  // <grep pattern="..."/> with many optional attributes
  grep: /<grep\s+[^>]*(?:\/>|>[\s\S]*?<\/grep>)/gi,
  // <ls path="/dir"/> or <ls path="/dir" ignore="node_modules,dist"/>
  ls: /<ls\s+[^>]*\/?>/gi,

  // ===== Git Operations =====
  // <git command="status"/> or <git command="diff" args="--staged"/>
  git: /<git\s+[^>]*\/?>/gi,

  // ===== Web Operations =====
  // <fetch url="..."/> or <fetch url="..." prompt="..."/>
  fetch: /<fetch\s+[^>]*\/?>/gi,
  // <search query="..."/> with optional domain filters
  search: /<search\s+[^>]*\/?>/gi,

  // ===== Code Quality =====
  // <format/> or <format path="..."/>
  format: /<format(?:\s+[^>]*)?\s*\/?>/gi,
  // <typecheck/>
  typecheck: /<typecheck\s*\/?>/gi,

  // ===== Scheduling & Notifications =====
  // <schedule cron="..." name="...">command</schedule>
  // <schedule cron="..." name="..." type="prompt">LLM prompt</schedule>
  // <schedule cron="..." name="..." type="llm">LLM prompt</schedule>
  schedule: /<schedule\s+[^>]*>([\s\S]+?)<\/schedule>/gi,
  // <notify>message</notify> or <notify to="telegram">message</notify>
  notify: /<notify(?:\s+to=["']([^"']+)["'])?\s*>([\s\S]+?)<\/notify>/gi,

  // ===== Skills =====
  // <skill name="..."/> or <skill name="..." args="..."/>
  skill: /<skill\s+[^>]*\/?>/gi,
  // <skill-install url="..."/> or <skill-install url="..." name="..."/>
  skillInstall: /<skill-install\s+[^>]*\/?>/gi,

  // ===== Sub-task Spawning =====
  // <task description="...">prompt</task>
  task: /<task(?:\s+[^>]*)?\s*>([\s\S]+?)<\/task>/gi,

  // ===== Plan Management =====
  // <plan operation="add" content="..." description="..."/>
  // <plan operation="update" id="..." status="in_progress"/>
  // <plan operation="complete" id="..."/>
  // <plan operation="remove" id="..."/>
  // <plan operation="show"/>
  // <plan operation="clear"/>
  // <plan operation="ask" question="What is your budget?"/>
  plan: /<plan\s+[^>]*\/?>/gi,

  // ===== Process Management =====
  // <ps/> - list running processes
  ps: /<ps\s*\/?>/gi,
  // <kill target="..."/> or <kill pid="..."/>
  kill: /<kill\s+[^>]*\/?>/gi,

  // ===== Connector Configuration =====
  // <telegram-config bot_token="..." chat_id="..."/>
  telegramConfig: /<telegram-config\s+[^>]*\/?>/gi,
  // <discord-config bot_token="..." channel_id="..."/>
  discordConfig: /<discord-config\s+[^>]*\/?>/gi,
};

/**
 * Remove code blocks from content to prevent parsing actions inside them
 */
function stripCodeBlocks(content: string): string {
  // Remove fenced code blocks (```...```)
  let result = content.replace(/```[\s\S]*?```/g, '');
  // Remove inline code (`...`)
  result = result.replace(/`[^`]+`/g, '');
  // Remove <literal>...</literal> blocks (explicit no-execute)
  result = result.replace(/<literal>[\s\S]*?<\/literal>/gi, '');
  return result;
}

/**
 * Parse inner edit blocks from multi-edit content
 */
function parseInnerEdits(
  content: string,
): Array<{ search: string; replace: string; replaceAll?: boolean }> {
  const edits: Array<{ search: string; replace: string; replaceAll?: boolean }> = [];
  const innerEditRegex =
    /<edit(?:\s+[^>]*)?>[\s\S]*?<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/gi;
  let match;
  while ((match = innerEditRegex.exec(content)) !== null) {
    const [fullMatch, search, replace] = match;
    const replaceAll =
      extractBoolAttr(fullMatch, 'replace_all') || extractBoolAttr(fullMatch, 'replaceAll');
    // Only strip leading/trailing newlines from XML formatting, preserve indentation
    const cleanSearch = search.replace(/^\n+|\n+$/g, '');
    const cleanReplace = replace.replace(/^\n+|\n+$/g, '');
    edits.push({
      search: cleanSearch,
      replace: cleanReplace,
      replaceAll: replaceAll || undefined,
    });
  }
  return edits;
}

/**
 * Parse all actions from content
 * Actions inside code blocks are ignored to prevent injection
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  // Fix truncated tags first (LLM sometimes cuts off at end)
  const fixedContent = fixTruncatedTags(content);

  let match;

  // ===== FIRST: Parse write/create actions from RAW content (before stripping) =====
  // This preserves code blocks inside write tags
  const writeRegex = new RegExp(PATTERNS.write.source, 'gi');
  while ((match = writeRegex.exec(fixedContent)) !== null) {
    const [, path, fileContent] = match;
    actions.push({
      type: 'write',
      path,
      content: fileContent.trim(),
    } as WriteAction);
  }

  const createRegex = new RegExp(PATTERNS.create.source, 'gi');
  while ((match = createRegex.exec(fixedContent)) !== null) {
    const [, path, fileContent] = match;
    actions.push({
      type: 'create',
      path,
      content: fileContent.trim(),
    } as CreateAction);
  }

  // Strip code blocks for OTHER actions (prevents executing actions in code examples)
  const safeContent = stripCodeBlocks(fixedContent);

  // ===== Shell Commands =====

  // Parse bash actions
  const bashRegex = new RegExp(PATTERNS.bash.source, 'gi');
  while ((match = bashRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const command = match[1].trim();
    const timeout = extractAttr(fullTag, 'timeout');
    const description = extractAttr(fullTag, 'description');
    const runInBackground = extractBoolAttr(fullTag, 'background');
    actions.push({
      type: 'bash',
      command,
      timeout: timeout ? parseInt(timeout, 10) : undefined,
      description: description || undefined,
      runInBackground: runInBackground || undefined,
    } as BashAction);
  }

  // Parse exec actions (legacy alias → treated as bash)
  const execRegex = new RegExp(PATTERNS.exec.source, 'gi');
  while ((match = execRegex.exec(safeContent)) !== null) {
    const command = match[1].trim();
    actions.push({
      type: 'exec',
      command,
    } as ExecAction);
  }

  // ===== File Operations =====

  // Parse read actions with offset/limit support
  const readRegex = new RegExp(PATTERNS.read.source, 'gi');
  while ((match = readRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const path = extractAttr(fullTag, 'path');
    const offset = extractAttr(fullTag, 'offset');
    const limit = extractAttr(fullTag, 'limit');
    if (path) {
      actions.push({
        type: 'read',
        path,
        offset: offset ? parseInt(offset, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      } as ReadAction);
    }
  }

  // Parse edit actions with replaceAll support
  const editRegex = new RegExp(PATTERNS.edit.source, 'gi');
  while ((match = editRegex.exec(safeContent)) !== null) {
    const fullMatch = match[0];
    const [, path, search, replace] = match;
    const replaceAll =
      extractBoolAttr(fullMatch, 'replace_all') || extractBoolAttr(fullMatch, 'replaceAll');
    // Only strip leading/trailing newlines from XML formatting, preserve indentation
    const cleanSearch = search.replace(/^\n+|\n+$/g, '');
    const cleanReplace = replace.replace(/^\n+|\n+$/g, '');
    actions.push({
      type: 'edit',
      path,
      search: cleanSearch,
      replace: cleanReplace,
      replaceAll: replaceAll || undefined,
    } as EditAction);
  }

  // Parse multi-edit actions
  const multiEditRegex = new RegExp(PATTERNS.multiEdit.source, 'gi');
  while ((match = multiEditRegex.exec(safeContent)) !== null) {
    const [, path, innerContent] = match;
    const edits = parseInnerEdits(innerContent);
    if (edits.length > 0) {
      actions.push({
        type: 'multi-edit',
        path,
        edits,
      } as MultiEditAction);
    }
  }

  // NOTE: write/create already parsed above from raw content (preserves code blocks)

  // ===== Search & Navigation =====

  // Parse glob actions
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

  // Parse grep actions with full ripgrep-style options
  const grepRegex = new RegExp(PATTERNS.grep.source, 'gi');
  while ((match = grepRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const pattern = extractAttr(fullTag, 'pattern');
    if (pattern) {
      const path = extractAttr(fullTag, 'path');
      const glob = extractAttr(fullTag, 'glob') || extractAttr(fullTag, 'file');
      const outputMode = extractAttr(fullTag, 'output') || extractAttr(fullTag, 'mode');
      const context = extractAttr(fullTag, 'context') || extractAttr(fullTag, 'C');
      const contextBefore = extractAttr(fullTag, 'before') || extractAttr(fullTag, 'B');
      const contextAfter = extractAttr(fullTag, 'after') || extractAttr(fullTag, 'A');
      const caseInsensitive =
        extractBoolAttr(fullTag, 'i') || extractAttr(fullTag, 'case') === 'insensitive';
      const lineNumbers = extractBoolAttr(fullTag, 'n') || extractBoolAttr(fullTag, 'lines');
      const headLimit = extractAttr(fullTag, 'limit') || extractAttr(fullTag, 'head');
      const multiline = extractBoolAttr(fullTag, 'multiline');

      actions.push({
        type: 'grep',
        pattern,
        path: path || undefined,
        glob: glob || undefined,
        outputMode: (outputMode as GrepAction['outputMode']) || undefined,
        context: context ? parseInt(context, 10) : undefined,
        contextBefore: contextBefore ? parseInt(contextBefore, 10) : undefined,
        contextAfter: contextAfter ? parseInt(contextAfter, 10) : undefined,
        caseInsensitive: caseInsensitive || undefined,
        lineNumbers: lineNumbers || undefined,
        headLimit: headLimit ? parseInt(headLimit, 10) : undefined,
        multiline: multiline || undefined,
      } as GrepAction);
    }
  }

  // Parse ls actions
  const lsRegex = new RegExp(PATTERNS.ls.source, 'gi');
  while ((match = lsRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const path = extractAttr(fullTag, 'path');
    const ignoreStr = extractAttr(fullTag, 'ignore');
    if (path) {
      actions.push({
        type: 'ls',
        path,
        ignore: ignoreStr ? ignoreStr.split(',').map(s => s.trim()) : undefined,
      } as LSAction);
    }
  }

  // ===== Git Operations =====

  // Parse git actions
  const gitRegex = new RegExp(PATTERNS.git.source, 'gi');
  while ((match = gitRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const command = extractAttr(fullTag, 'command');
    const args = extractAttr(fullTag, 'args');
    if (
      command &&
      ['status', 'diff', 'log', 'branch', 'add', 'commit', 'checkout', 'stash'].includes(command)
    ) {
      actions.push({
        type: 'git',
        command: command as GitAction['command'],
        args: args || undefined,
      } as GitAction);
    }
  }

  // ===== Web Operations =====

  // Parse fetch actions
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

  // Parse search actions with domain filters
  const searchRegex = new RegExp(PATTERNS.search.source, 'gi');
  while ((match = searchRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const query = extractAttr(fullTag, 'query');
    const allowedDomainsStr =
      extractAttr(fullTag, 'allowed_domains') || extractAttr(fullTag, 'domains');
    const blockedDomainsStr =
      extractAttr(fullTag, 'blocked_domains') || extractAttr(fullTag, 'exclude');
    if (query) {
      actions.push({
        type: 'search',
        query,
        allowedDomains: allowedDomainsStr
          ? allowedDomainsStr.split(',').map(s => s.trim())
          : undefined,
        blockedDomains: blockedDomainsStr
          ? blockedDomainsStr.split(',').map(s => s.trim())
          : undefined,
      } as SearchAction);
    }
  }

  // ===== Code Quality =====

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

  // ===== Scheduling & Notifications =====

  // Parse schedule actions
  const scheduleRegex = new RegExp(PATTERNS.schedule.source, 'gi');
  while ((match = scheduleRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const content = match[1].trim();
    const cron = extractAttr(fullTag, 'cron');
    const name = extractAttr(fullTag, 'name');
    const typeAttr = extractAttr(fullTag, 'type');

    // Detect if this is an LLM prompt task:
    // - explicit type="prompt" or type="llm"
    // - or legacy prompt="true"
    const isPromptTask =
      typeAttr === 'prompt' || typeAttr === 'llm' || extractBoolAttr(fullTag, 'prompt');

    if (cron) {
      actions.push({
        type: 'schedule',
        cron,
        name: name || 'Scheduled Task',
        command: isPromptTask ? undefined : content,
        prompt: isPromptTask ? content : undefined,
      } as ScheduleAction);
    }
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

  // ===== Skills =====

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

  // Parse task actions (sub-task spawning)
  const taskRegex = new RegExp(PATTERNS.task.source, 'gi');
  while ((match = taskRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const prompt = match[1].trim();
    const description = extractAttr(fullTag, 'description');
    if (prompt) {
      actions.push({
        type: 'task',
        prompt,
        description: description || undefined,
      } as TaskAction);
    }
  }

  // Parse plan actions (task planning & tracking)
  const planRegex = new RegExp(PATTERNS.plan.source, 'gi');
  while ((match = planRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const operation = extractAttr(fullTag, 'operation') || extractAttr(fullTag, 'op');
    if (operation && ['add', 'update', 'complete', 'remove', 'show', 'clear', 'ask'].includes(operation)) {
      const id = extractAttr(fullTag, 'id');
      const content = extractAttr(fullTag, 'content') || extractAttr(fullTag, 'task');
      const description = extractAttr(fullTag, 'description') || extractAttr(fullTag, 'desc');
      const status = extractAttr(fullTag, 'status') as PlanItemStatus | undefined;
      const question = extractAttr(fullTag, 'question') || extractAttr(fullTag, 'q');

      actions.push({
        type: 'plan',
        operation: operation as PlanAction['operation'],
        id: id || undefined,
        content: content || undefined,
        description: description || undefined,
        status: status || undefined,
        question: question || undefined,
      } as PlanAction);
    }
  }

  // Parse ps actions (list processes)
  const psRegex = new RegExp(PATTERNS.ps.source, 'gi');
  while ((match = psRegex.exec(safeContent)) !== null) {
    actions.push({ type: 'ps' } as PsAction);
  }

  // Parse kill actions
  const killRegex = new RegExp(PATTERNS.kill.source, 'gi');
  while ((match = killRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const target =
      extractAttr(fullTag, 'target') || extractAttr(fullTag, 'pid') || extractAttr(fullTag, 'id');
    if (target) {
      actions.push({
        type: 'kill',
        target,
      } as KillAction);
    }
  }

  // Parse telegram-config actions
  const telegramConfigRegex = new RegExp(PATTERNS.telegramConfig.source, 'gi');
  while ((match = telegramConfigRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const botToken = extractAttr(fullTag, 'bot_token') || extractAttr(fullTag, 'token');
    const chatId = extractAttr(fullTag, 'chat_id');
    if (botToken) {
      actions.push({
        type: 'telegram-config',
        botToken,
        chatId: chatId || undefined,
      } as any);
    }
  }

  // Parse discord-config actions
  const discordConfigRegex = new RegExp(PATTERNS.discordConfig.source, 'gi');
  while ((match = discordConfigRegex.exec(safeContent)) !== null) {
    const fullTag = match[0];
    const botToken = extractAttr(fullTag, 'bot_token') || extractAttr(fullTag, 'token');
    const channelId = extractAttr(fullTag, 'channel_id');
    if (botToken && channelId) {
      actions.push({
        type: 'discord-config',
        botToken,
        channelId,
      } as any);
    }
  }

  return actions;
}
