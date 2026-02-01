/**
 * Action Executor - Execute parsed actions with Claude Code-style display
 * Aligned with Claude Code tool schema
 */

import type {
  Action,
  ActionResult,
  ActionHandlers,
  GrepOptions,
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
  ExecAction,
  PsAction,
  KillAction,
} from './types';
import { step, planStep, stickyPlan } from '../ui/colors';

/**
 * Execute a list of actions and return results
 */
export async function executeActions(
  actions: Action[],
  handlers: ActionHandlers,
): Promise<ActionResult[]> {
  if (actions.length === 0) {
    return [];
  }

  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(action, handlers);
    if (result) {
      results.push(result);
      console.log('');
    }
  }

  return results;
}

async function executeAction(
  action: Action,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  switch (action.type) {
    // Shell Commands
    case 'bash':
      return executeBash(action, handlers);
    case 'exec':
      return executeExec(action, handlers);

    // File Operations
    case 'read':
      return executeRead(action, handlers);
    case 'edit':
      return executeEdit(action, handlers);
    case 'multi-edit':
      return executeMultiEdit(action, handlers);
    case 'write':
      return executeWrite(action, handlers);
    case 'create':
      return executeCreate(action, handlers);

    // Search & Navigation
    case 'glob':
      return executeGlob(action, handlers);
    case 'grep':
      return executeGrep(action, handlers);
    case 'ls':
      return executeLS(action, handlers);

    // Git Operations
    case 'git':
      return executeGit(action, handlers);

    // Web Operations
    case 'fetch':
      return executeFetch(action, handlers);
    case 'search':
      return executeSearch(action, handlers);

    // Code Quality
    case 'format':
      return executeFormat(action, handlers);
    case 'typecheck':
      return executeTypecheck(action, handlers);

    // Scheduling & Notifications
    case 'schedule':
      return executeSchedule(action, handlers);
    case 'notify':
      return executeNotify(action, handlers);

    // Skills
    case 'skill':
      return executeSkill(action, handlers);
    case 'skill-install':
      return executeSkillInstall(action, handlers);

    // Sub-task Spawning
    case 'task':
      return executeTask(action, handlers);

    // Plan Management
    case 'plan':
      return executePlan(action, handlers);

    // Connector Configuration
    case 'telegram-config':
      return executeTelegramConfig(action as any, handlers);
    case 'discord-config':
      return executeDiscordConfig(action as any, handlers);

    default:
      return null;
  }
}

// ===== Shell Commands =====

/**
 * Execute a shell command (handles both bash and exec action types)
 */
async function executeShellCommand(
  command: string,
  handlers: ActionHandlers,
  options?: { timeout?: number; runInBackground?: boolean; description?: string },
): Promise<ActionResult | null> {
  const handler = handlers.onBash || handlers.onExec;
  if (!handler) return null;

  // Display action with optional description
  const desc = options?.description ? ` (${options.description})` : '';
  step.bash(command + desc);

  // Execute using available handler
  const output = await (handlers.onBash
    ? handlers.onBash(command, {
        timeout: options?.timeout,
        runInBackground: options?.runInBackground,
      })
    : handlers.onExec!(command));

  const isError = output?.startsWith('Error:') || output?.includes('Command blocked');

  // Display result
  step.bashResult(command, output || '', isError ? 1 : 0);

  const truncatedCmd = command.length > 50 ? command.slice(0, 50) + '...' : command;
  return {
    action: `Bash: ${truncatedCmd}`,
    success: !isError,
    result: output || 'OK',
    error: isError ? output : undefined,
  };
}

async function executeBash(
  action: BashAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  return executeShellCommand(action.command, handlers, {
    timeout: action.timeout,
    runInBackground: action.runInBackground,
    description: action.description,
  });
}

async function executeExec(
  action: ExecAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  return executeShellCommand(action.command, handlers);
}

// ===== File Operations =====

async function executeRead(
  action: ReadAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onRead) return null;

  // Display action in Claude Code style
  const rangeInfo =
    action.offset || action.limit
      ? ` (offset: ${action.offset || 0}, limit: ${action.limit || 'all'})`
      : '';
  step.read(action.path + rangeInfo);

  const fileContent = await handlers.onRead(action.path, {
    offset: action.offset,
    limit: action.limit,
  });

  if (fileContent) {
    const lineCount = fileContent.split('\n').length;
    step.readResult(lineCount);
    const preview = fileContent.length > 1000 ? fileContent.slice(0, 1000) + '...' : fileContent;
    return { action: `Read: ${action.path}`, success: true, result: preview };
  } else {
    step.error('File not found');
    return {
      action: `Read: ${action.path}`,
      success: false,
      result: 'File not found',
      error: 'File not found',
    };
  }
}

async function executeEdit(
  action: EditAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onEdit) return null;

  step.update(action.path);

  const result = await handlers.onEdit(
    action.path,
    action.search,
    action.replace,
    action.replaceAll,
  );

  const searchLines = action.search.split('\n');
  const replaceLines = action.replace.split('\n');

  if (result.status === 'applied') {
    step.updateResult(true, searchLines.length, replaceLines.length);
    step.diff(searchLines, replaceLines);
  } else if (result.status === 'already_applied') {
    step.success('Already applied (skipped)');
  } else if (result.status === 'not_found') {
    step.updateResult(false, 0, 0);
    if (result.message?.includes('File not found')) {
      step.error(
        `File not found: ${action.path}. Use <read> to check if file exists, or <write> to make a new file.`,
      );
    } else {
      step.error(
        `Pattern not found. Use <read path="${action.path}"/> first to see the actual content.`,
      );
    }
  } else {
    step.updateResult(false, 0, 0);
  }

  let errorMsg = result.message;
  if (!result.success && result.status === 'not_found') {
    errorMsg = result.message?.includes('File not found')
      ? `${result.message} - Use <read> to verify path or <write> to make new file`
      : `${result.message} - Use <read path="${action.path}"/> first to see actual content`;
  }

  return {
    action: `Edit: ${action.path}`,
    success: result.success,
    result:
      result.status === 'already_applied'
        ? 'Skipped (already applied)'
        : result.success
          ? 'OK'
          : 'Failed',
    error: result.success ? undefined : errorMsg,
  };
}

async function executeMultiEdit(
  action: MultiEditAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onMultiEdit && !handlers.onEdit) return null;

  step.tool('MultiEdit', `${action.path} (${action.edits.length} edits)`);

  let result;
  if (handlers.onMultiEdit) {
    result = await handlers.onMultiEdit(action.path, action.edits);
  } else {
    // Fallback: execute edits sequentially
    for (const edit of action.edits) {
      result = await handlers.onEdit!(action.path, edit.search, edit.replace, edit.replaceAll);
      if (!result.success && result.status !== 'already_applied') {
        break;
      }
    }
    result = result || { success: true, status: 'applied' as const, message: 'OK' };
  }

  if (result.success) {
    step.result(`Applied ${action.edits.length} edits`);
  } else {
    step.error(result.message || 'Multi-edit failed');
  }

  return {
    action: `MultiEdit: ${action.path}`,
    success: result.success,
    result: result.success ? `Applied ${action.edits.length} edits` : 'Failed',
    error: result.success ? undefined : result.message,
  };
}

async function executeWrite(
  action: WriteAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const handler = handlers.onWrite || handlers.onCreate;
  if (!handler) return null;

  step.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  step.writeResult(success, lineCount);

  return {
    action: `Write: ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to write file',
  };
}

async function executeCreate(
  action: CreateAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const handler = handlers.onCreate || handlers.onWrite;
  if (!handler) return null;

  step.write(action.path);

  const success = await handler(action.path, action.content);
  const lineCount = action.content.split('\n').length;

  step.writeResult(success, lineCount);

  return {
    action: `Write: ${action.path}`,
    success,
    result: success ? 'OK' : 'Failed',
    error: success ? undefined : 'Failed to create file',
  };
}

// ===== Search & Navigation =====

async function executeGlob(
  action: GlobAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGlob) return null;

  const pathInfo = action.path ? `, "${action.path}"` : '';
  step.tool('Glob', `"${action.pattern}"${pathInfo}`);

  try {
    const files = await handlers.onGlob(action.pattern, action.path);

    if (files.length === 0) {
      step.result('No files found');
    } else {
      const preview = files.slice(0, 10).join('\n');
      step.result(
        `Found ${files.length} file${files.length > 1 ? 's' : ''}\n${preview}${files.length > 10 ? `\n... and ${files.length - 10} more` : ''}`,
      );
    }

    return {
      action: `Glob: ${action.pattern}`,
      success: true,
      result: files.length > 0 ? files.join('\n') : 'No files found',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Glob failed: ${errorMsg}`);
    return {
      action: `Glob: ${action.pattern}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeGrep(
  action: GrepAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGrep) return null;

  // Build options display string
  const opts: string[] = [];
  if (action.context) opts.push(`-C${action.context}`);
  if (action.contextBefore) opts.push(`-B${action.contextBefore}`);
  if (action.contextAfter) opts.push(`-A${action.contextAfter}`);
  if (action.caseInsensitive) opts.push('-i');
  if (action.lineNumbers) opts.push('-n');
  if (action.multiline) opts.push('-U');
  if (action.headLimit) opts.push(`limit:${action.headLimit}`);
  const optsStr = opts.length > 0 ? ` ${opts.join(' ')}` : '';
  const pathInfo = action.path ? ` in ${action.path}` : '';
  const globInfo = action.glob ? ` (${action.glob})` : '';

  step.grep(action.pattern + optsStr + pathInfo + globInfo);

  // Build options for handler
  const grepOptions: GrepOptions = {
    path: action.path,
    glob: action.glob,
    outputMode: action.outputMode,
    context: action.context,
    contextBefore: action.contextBefore,
    contextAfter: action.contextAfter,
    caseInsensitive: action.caseInsensitive,
    lineNumbers: action.lineNumbers,
    headLimit: action.headLimit,
    multiline: action.multiline,
  };

  const grepResults = await handlers.onGrep(action.pattern, grepOptions);
  const lines = grepResults ? grepResults.split('\n').filter(l => l.trim()) : [];

  step.grepResult(lines.length, lines.length > 0 ? lines.slice(0, 5).join('\n') : undefined);

  return {
    action: `Grep: ${action.pattern}`,
    success: true,
    result: grepResults || 'No results',
  };
}

async function executeLS(action: LSAction, handlers: ActionHandlers): Promise<ActionResult | null> {
  if (!handlers.onLS) return null;

  const ignoreInfo = action.ignore?.length ? ` (ignore: ${action.ignore.join(', ')})` : '';
  step.tool('LS', `${action.path}${ignoreInfo}`);

  try {
    const entries = await handlers.onLS(action.path, action.ignore);

    if (entries.length === 0) {
      step.result('Empty directory');
    } else {
      const preview = entries.slice(0, 15).join('\n');
      step.result(
        `${entries.length} entries\n${preview}${entries.length > 15 ? `\n... and ${entries.length - 15} more` : ''}`,
      );
    }

    return {
      action: `LS: ${action.path}`,
      success: true,
      result: entries.join('\n') || 'Empty directory',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`LS failed: ${errorMsg}`);
    return {
      action: `LS: ${action.path}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Git Operations =====

async function executeGit(
  action: GitAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGit) return null;

  const argsInfo = action.args ? ` ${action.args}` : '';
  step.tool('Git', `${action.command}${argsInfo}`);

  try {
    const output = await handlers.onGit(action.command, action.args);
    const lines = output.split('\n').filter(l => l.trim());
    const isError = output.startsWith('Error:') || output.includes('fatal:');

    if (isError) {
      step.error(output.slice(0, 100));
    } else {
      const preview = lines.slice(0, 8).join('\n');
      step.result(
        `${lines.length} line${lines.length !== 1 ? 's' : ''}\n${preview}${lines.length > 8 ? `\n... and ${lines.length - 8} more` : ''}`,
      );
    }

    return {
      action: `Git: ${action.command}`,
      success: !isError,
      result: output || 'OK',
      error: isError ? output : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Git failed: ${errorMsg}`);
    return {
      action: `Git: ${action.command}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Web Operations =====

async function executeFetch(
  action: FetchAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onFetch) return null;

  const shortUrl = action.url.length > 50 ? action.url.slice(0, 47) + '...' : action.url;
  const promptInfo = action.prompt ? `, "${action.prompt.slice(0, 30)}..."` : '';
  step.tool('Fetch', `${shortUrl}${promptInfo}`);

  try {
    const content = await handlers.onFetch(action.url, action.prompt);
    const lines = content.split('\n').length;
    const charCount = content.length;

    step.result(`Fetched ${charCount} chars, ${lines} lines`);

    return {
      action: `Fetch: ${action.url}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Fetch failed: ${errorMsg}`);
    return {
      action: `Fetch: ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeSearch(
  action: SearchAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSearch) return null;

  const domainInfo = action.allowedDomains?.length
    ? ` (domains: ${action.allowedDomains.join(', ')})`
    : action.blockedDomains?.length
      ? ` (exclude: ${action.blockedDomains.join(', ')})`
      : '';
  step.tool('Search', `"${action.query}"${domainInfo}`);

  try {
    const { response, citations } = await handlers.onSearch(action.query, {
      allowedDomains: action.allowedDomains,
      blockedDomains: action.blockedDomains,
    });

    if (citations.length > 0) {
      const citationPreview = citations.slice(0, 3).join(', ');
      step.result(
        `Found ${citations.length} sources: ${citationPreview}${citations.length > 3 ? '...' : ''}`,
      );
    } else {
      step.result('Search completed');
    }

    return {
      action: `Search: ${action.query}`,
      success: true,
      result: response,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Search failed: ${errorMsg}`);
    return {
      action: `Search: ${action.query}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Code Quality =====

async function executeFormat(
  action: FormatAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onFormat) return null;

  const pathInfo = action.path ? `(${action.path})` : '';
  step.tool('Format', pathInfo);

  try {
    const output = await handlers.onFormat(action.path);
    step.result(output || 'Formatted');

    return {
      action: 'Format',
      success: true,
      result: output || 'OK',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Format failed: ${errorMsg}`);
    return {
      action: 'Format',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeTypecheck(
  action: TypecheckAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTypecheck) return null;

  step.tool('Typecheck', '');

  try {
    const output = await handlers.onTypecheck();
    // Check for actual errors (not "No errors" success message)
    const hasErrors =
      (output.includes('error') || output.includes('Error')) &&
      !output.includes('No errors') &&
      output.trim() !== '';

    if (hasErrors) {
      step.result(output, true);
    } else {
      step.result(output || 'No errors');
    }

    return {
      action: 'Typecheck',
      success: !hasErrors,
      result: output || 'OK',
      error: hasErrors ? output : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Typecheck failed: ${errorMsg}`);
    return {
      action: 'Typecheck',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Scheduling & Notifications =====

async function executeSchedule(
  action: ScheduleAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSchedule) return null;

  const isPrompt = !!action.prompt;
  const content = action.prompt || action.command || '';

  step.schedule(action.name, action.cron);
  if (isPrompt) {
    step.thinking(`AI-powered task: ${content.slice(0, 50)}...`);
  }

  await handlers.onSchedule(action.cron, content, action.name, { isPrompt });

  step.success(`Scheduled: ${action.cron}${isPrompt ? ' (AI task)' : ''}`);

  return {
    action: `Schedule: ${action.name}`,
    success: true,
    result: `Scheduled: ${action.cron}${isPrompt ? ' (AI-powered)' : ''}`,
  };
}

async function executeNotify(
  action: NotifyAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onNotify) {
    step.error('No connectors configured');
    return {
      action: 'Notify',
      success: false,
      result: 'No connectors available',
      error: 'Configure Telegram or Discord',
    };
  }

  const targetInfo = action.target ? ` to ${action.target}` : ' to all';
  step.thinking(`Sending${targetInfo}...`);

  try {
    const result = await handlers.onNotify(action.message, action.target);

    if (result.sent.length > 0) {
      step.success(`Sent to: ${result.sent.join(', ')}`);
    }
    if (result.failed.length > 0) {
      step.error(`Failed: ${result.failed.join(', ')}`);
    }

    return {
      action: 'Notify',
      success: result.sent.length > 0,
      result: result.sent.length > 0 ? `Sent to ${result.sent.join(', ')}` : 'No messages sent',
      error: result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Notify failed: ${errorMsg}`);
    return {
      action: 'Notify',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Skills =====

async function executeSkill(
  action: SkillAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSkill) return null;

  const argsInfo = action.args ? ` "${action.args}"` : '';
  step.tool('Skill', `${action.name}${argsInfo}`);

  try {
    const content = await handlers.onSkill(action.name, action.args);

    step.result(`Loaded skill: ${action.name}`);

    return {
      action: `Skill: ${action.name}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill failed: ${errorMsg}`);
    return {
      action: `Skill: ${action.name}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeSkillInstall(
  action: SkillInstallAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSkillInstall) return null;

  const nameInfo = action.name ? ` as "${action.name}"` : '';
  step.tool('SkillInstall', `${action.url}${nameInfo}`);

  try {
    const result = await handlers.onSkillInstall(action.url, action.name);

    step.result(`Installed skill: ${result.name} → ${result.path}`);

    return {
      action: `SkillInstall: ${action.url}`,
      success: true,
      result: `Skill "${result.name}" installed at ${result.path}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Skill install failed: ${errorMsg}`);
    return {
      action: `SkillInstall: ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Sub-task Spawning =====

async function executeTask(
  action: TaskAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTask) return null;

  const desc =
    action.description || action.prompt.slice(0, 50) + (action.prompt.length > 50 ? '...' : '');
  step.tool('Task', desc);

  try {
    const result = await handlers.onTask(action.prompt, action.description);

    step.result(`Sub-task completed`);

    return {
      action: `Task: ${desc}`,
      success: true,
      result,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Task failed: ${errorMsg}`);
    return {
      action: `Task: ${desc}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Connector Configuration =====

async function executeTelegramConfig(
  action: { type: 'telegram-config'; botToken: string; chatId?: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onTelegramConfig) return null;

  step.tool('TelegramConfig', action.chatId ? `chat_id: ${action.chatId}` : 'auto-detect chat_id');

  try {
    const result = await handlers.onTelegramConfig(action.botToken, action.chatId);

    if (result.success) {
      step.result(`Telegram configured! Chat ID: ${result.chatId || action.chatId}`);
    } else {
      step.error(result.message);
    }

    return {
      action: 'TelegramConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Telegram config failed: ${errorMsg}`);
    return {
      action: 'TelegramConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

async function executeDiscordConfig(
  action: { type: 'discord-config'; botToken: string; channelId: string },
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onDiscordConfig) return null;

  step.tool('DiscordConfig', `channel_id: ${action.channelId}`);

  try {
    const result = await handlers.onDiscordConfig(action.botToken, action.channelId);

    if (result.success) {
      step.result(`Discord configured! Channel ID: ${action.channelId}`);
    } else {
      step.error(result.message);
    }

    return {
      action: 'DiscordConfig',
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Discord config failed: ${errorMsg}`);
    return {
      action: 'DiscordConfig',
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

// ===== Plan Management =====

async function executePlan(
  action: PlanAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onPlan) return null;

  // Silent plan updates - no verbose logging
  try {
    const result = await handlers.onPlan(action.operation, {
      id: action.id,
      content: action.content,
      description: action.description,
      status: action.status,
      question: action.question,
    });

    if (result.success && result.plan) {
      // Update sticky plan state
      stickyPlan.setItems(result.plan);

      // Show progress inline for status changes
      if (action.operation === 'show') {
        stickyPlan.print();
      } else if (action.operation === 'complete') {
        // Show progress when completing steps
        const completed = result.plan.filter(i => i.status === 'completed').length;
        const total = result.plan.length;
        const filled = Math.round((completed / total) * 5);
        const bar = `\x1b[32m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(5 - filled)}\x1b[0m`;
        process.stdout.write(`${bar} ${completed}/${total} \x1b[32m✓\x1b[0m\n`);
      } else if (action.operation === 'update' && action.status === 'in_progress') {
        // Show current task when starting
        const item = result.plan.find(i => i.id === action.id);
        if (item) {
          process.stdout.write(`\x1b[33m◉\x1b[0m ${item.content.slice(0, 50)}\n`);
        }
      } else if (action.operation === 'clear') {
        stickyPlan.clear();
      }
    } else if (action.operation === 'ask' && result.question) {
      step.message(`❓ ${result.question}`);
    } else if (!result.success) {
      step.error(result.message);
    }

    return {
      action: `Plan: ${action.operation}`,
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    step.error(`Plan failed: ${errorMsg}`);
    return {
      action: `Plan: ${action.operation}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
