import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { GitStatusAction, GitDiffAction, GitLogAction, GitCommitAction } from './types';
import { display, formatToolAction } from '../../core/ui';

async function runGit(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd: cwd || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

export async function executeGitStatus(
  _action: GitStatusAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const result = await runGit(['status', '--short', '--branch']);
  if (result.exitCode !== 0) {
    display.appendAssistantMessage(formatToolAction('Git', 'status', { success: false, summary: 'not a git repo' }));
    return {
      action: 'GitStatus',
      success: false,
      result: 'Not a git repository',
      error: result.stderr,
    };
  }

  const output = result.stdout || 'Clean working tree';
  const lines = output.split('\n');
  const truncated =
    lines.length > 10
      ? lines.slice(0, 10).join('\n') + `\n... (truncated ${lines.length - 10} more lines)`
      : output;

  display.appendAssistantMessage(formatToolAction('Git', 'status', { success: true }));
  return { action: 'GitStatus', success: true, result: truncated };
}

export async function executeGitDiff(
  action: GitDiffAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const args = ['diff'];
  if (action.staged) args.push('--staged');
  if (action.ref) args.push(action.ref);
  const detail = `diff${action.staged ? ' --staged' : ''}${action.ref ? ' ' + action.ref : ''}`;

  const result = await runGit(args);
  const output = result.stdout || 'No differences found';
  const lines = output.split('\n');
  const truncated =
    lines.length > 50
      ? lines.slice(0, 50).join('\n') + `\n... (truncated ${lines.length - 50} more lines)`
      : output;

  display.appendAssistantMessage(formatToolAction('Git', detail, { success: true }));
  return { action: 'GitDiff', success: true, result: truncated };
}

export async function executeGitLog(
  action: GitLogAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const count = action.count || 10;
  const result = await runGit(['log', `--oneline`, `-${count}`]);
  if (result.exitCode !== 0) {
    display.appendAssistantMessage(formatToolAction('Git', `log -${count}`, { success: false }));
    return { action: 'GitLog', success: false, result: 'Failed', error: result.stderr };
  }

  display.appendAssistantMessage(
    formatToolAction('Git', `log -${count}`, { success: true, summary: `${result.stdout.split('\n').length} commits` }),
  );
  return { action: 'GitLog', success: true, result: result.stdout || 'No commits' };
}

export async function executeGitCommit(
  action: GitCommitAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const detail = `commit: ${action.message.slice(0, 60)}`;

  // Stage files if specified, otherwise stage all changes
  if (action.files && action.files.length > 0) {
    const addResult = await runGit(['add', ...action.files]);
    if (addResult.exitCode !== 0) {
      display.appendAssistantMessage(formatToolAction('Git', detail, { success: false, summary: 'stage failed' }));
      return {
        action: `GitCommit: ${action.message}`,
        success: false,
        result: 'Stage failed',
        error: addResult.stderr,
      };
    }
  } else {
    await runGit(['add', '-A']);
  }

  // Commit
  const result = await runGit(['commit', '-m', action.message]);
  if (result.exitCode !== 0) {
    display.appendAssistantMessage(formatToolAction('Git', detail, { success: false, summary: 'commit failed' }));
    return {
      action: `GitCommit: ${action.message}`,
      success: false,
      result: 'Commit failed',
      error: result.stderr,
    };
  }

  display.appendAssistantMessage(formatToolAction('Git', detail, { success: true }));
  return { action: `GitCommit: ${action.message}`, success: true, result: result.stdout };
}
