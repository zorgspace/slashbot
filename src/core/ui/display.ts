/**
 * DisplayService - Central UI output singleton
 *
 * Replaces: step, c, colors, ThinkingAnimation, thinkingDisplay, banner, fileViewer, state, errorBlock, successBlock
 *
 * Before bindTUI(): all output goes to console.log (plain text fallback).
 * After bindTUI(): all output renders natively in TUI with OpenTUI styled text.
 */

import { t, fg, bold, dim, type StyledText } from '@opentui/core';
import { theme } from './theme';
import type { UIOutput } from './types';

export interface TUISpinnerCallbacks {
  showSpinner: (label: string) => void;
  hideSpinner: () => void;
}

// Static TUI callbacks - set once when TUI is initialized
let tuiSpinnerCallbacks: TUISpinnerCallbacks | null = null;

export function setTUISpinnerCallbacks(callbacks: TUISpinnerCallbacks | null): void {
  tuiSpinnerCallbacks = callbacks;
}

// Tool-specific icons for visual clarity
const TOOL_ICONS: Record<string, string> = {
  Exec: '$',
  Read: '\u2192',
  Create: '\u2190',
  Edit: '\u2190',
  Grep: '\u2731',
  Explore: '\u25C7',
  Schedule: '\u23F0',
  Skill: '\u26A1',
  Heartbeat: '\u2665',
  HeartbeatUpdate: '\u2665',
  Image: '\u25A3',
  Say: '\u25CB',
};

class DisplayService {
  private tui: UIOutput | null = null;
  private thinkingStartTime = 0;
  private thinkingCallback: ((chunk: string) => void) | null = null;
  private pendingAction: StyledText | null = null;

  bindTUI(tui: UIOutput): void {
    this.tui = tui;
  }

  unbindTUI(): void {
    this.tui = null;
  }

  // === Core output ===

  scrollToBottom(): void {
    // No-op: content panel grows dynamically, no forced scroll
  }

  append(text: string): void {
    if (this.tui) {
      this.tui.appendChat(text);
    } else {
      console.log(text);
    }
  }

  appendStyled(content: StyledText | string): void {
    if (this.tui) {
      this.tui.appendStyledChat(content);
    } else {
      // Fallback: extract plain text from StyledText chunks
      const plain =
        typeof content === 'string'
          ? this.stripAnsi(content)
          : content.chunks.map(c => c.text).join('');
      console.log(plain);
    }
  }

  appendAssistant(text: string): void {
    if (this.tui) {
      this.tui.appendAssistantChat(text);
    } else {
      console.log(`\x1b[38;2;157;124;216m┃\x1b[0m ${text}`);
    }
  }

  appendAssistantStyled(content: StyledText | string): void {
    if (this.tui) {
      this.tui.appendAssistantChat(content);
    } else {
      const plain =
        typeof content === 'string'
          ? this.stripAnsi(content)
          : content.chunks.map(c => c.text).join('');
      console.log(`\x1b[38;2;157;124;216m┃\x1b[0m ${plain}`);
    }
  }

  // === Step methods (replaces step.* from display/step.ts) ===

  newline(): void {
    this.append('');
  }

  message(text: string): void {
    this.appendStyled(t`${fg(theme.primary)('\u25CF')} ${text}`);
  }

  tool(name: string, args?: string): void {
    const context = args ? t` ${fg(theme.muted)('-')} ${args}` : t``;
    this._startAction(this._mergeStyled(t`${bold(fg(theme.accent)(name))}`, context));
  }

  result(text: string, isError = false): void {
    const isSuccess =
      text.includes('No errors') ||
      text.includes('success') ||
      text.includes('Created') ||
      text.includes('Updated');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const checkmark = i === 0 && isSuccess && !isError ? '\u2713 ' : '';
      if (isError) {
        this.appendAssistantStyled(t`${fg(theme.error)(checkmark + line)}`);
      } else if (isSuccess) {
        this.appendAssistantStyled(t`${fg(theme.success)(checkmark + line)}`);
      } else {
        this.appendAssistantStyled(t`${fg(theme.white)(checkmark + line)}`);
      }
    });
  }

  read(path: string, output?: string): void {
    this._stepAction('Read', path, output);
  }

  readResult(path: string, lineCount: number): void {
    this._endAction(
      t`${bold(fg(theme.accent)('Read'))} ${fg(theme.muted)('-')} ${path} ${fg(theme.muted)(lineCount + ' lines')}`,
    );
  }

  grep(pattern: string, filePattern?: string, output?: string): void {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    this._stepAction('Grep', args, output);
  }

  grepResult(
    pattern: string,
    filePattern: string | undefined,
    matches: number,
    preview?: string,
  ): void {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    const resultText =
      matches === 0 ? 'No matches' : matches + ' match' + (matches > 1 ? 'es' : '');
    if (matches > 0 && preview) {
      preview.split('\n').forEach(line => {
        this._appendActionContent(t`${fg(theme.muted)(line)}`);
      });
    }
    this._endAction(
      t`${bold(fg(theme.accent)('Grep'))} ${fg(theme.muted)('-')} ${args} ${fg(theme.muted)(resultText)}`,
    );
  }

  bash(command: string, _output?: string): void {
    this._startAction(t`${bold(fg(theme.accent)('Exec'))} ${fg(theme.muted)('-')} ${command}`);
  }

  bashResult(_command: string, output: string, exitCode = 0): void {
    const isError = exitCode !== 0 || output.startsWith('Error:');
    // Complete the action title with status
    // Output content is captured by action box redirect from OutputInterceptor
    const resultStatus = isError
      ? t`${fg(theme.error)('\u2717 exit ' + exitCode)}`
      : t`${fg(theme.success)('\u2713')}`;
    if (this.pendingAction) {
      this._endAction(this._mergeStyled(this.pendingAction, t` `, resultStatus));
    } else {
      this._endAction(resultStatus);
    }
  }

  update(path: string, output?: string): void {
    this._stepAction('Edit', path, output);
  }

  updateResult(path: string, success: boolean, _removed: number, _added: number): void {
    const status = success
      ? t`${fg(theme.success)('\u2713')}`
      : t`${fg(theme.error)('\u2717 pattern not found')}`;
    this._endAction(
      this._mergeStyled(
        t`${bold(fg(theme.accent)('Edit'))} ${fg(theme.muted)('-')} ${path} `,
        status,
      ),
    );
  }

  write(path: string, output?: string): void {
    this._stepAction('Create', path, output);
  }

  writeResult(path: string, success: boolean, lineCount?: number): void {
    const info = lineCount ? ` ${lineCount} lines` : '';
    const status = success
      ? t`${fg(theme.success)('\u2713' + info)}`
      : t`${fg(theme.error)('\u2717 failed')}`;
    this._endAction(
      this._mergeStyled(
        t`${bold(fg(theme.accent)('Create'))} ${fg(theme.muted)('-')} ${path} `,
        status,
      ),
    );
  }

  schedule(name: string, cron: string, output?: string): void {
    this._stepAction('Schedule', `${name}, "${cron}"`, output);
  }

  skill(name: string, output?: string): void {
    this._stepAction('Skill', name, output);
  }

  success(msg: string): void {
    this.appendAssistantStyled(t`${fg(theme.success)('\u2713 ' + msg)}`);
  }

  error(msg: string): void {
    this.appendAssistantStyled(t`${fg(theme.error)('Error: ' + msg)}`);
  }

  warning(msg: string): void {
    this.appendAssistantStyled(t`${fg(theme.warning)('\u26A0 ' + msg)}`);
  }

  diff(removed: string[], added: string[], filePath?: string, lineStart = 1): void {
    if (this.tui) {
      // Build unified diff format for DiffRenderable
      const header = [
        `--- a/${filePath || 'file'}`,
        `+++ b/${filePath || 'file'}`,
        `@@ -${lineStart},${removed.length} +${lineStart},${added.length} @@`,
      ];
      const diffLines = [
        ...header,
        ...removed.map(line => `-${line}`),
        ...added.map(line => `+${line}`),
      ];
      const ext = filePath?.split('.').pop();
      this.tui.appendDiffBlock(diffLines.join('\n'), ext);
    } else {
      // Console fallback
      removed.forEach((line, i) => {
        const lineNum = String(lineStart + i).padStart(3, ' ');
        console.log(`      ${lineNum} - ${line}`);
      });
      added.forEach((line, i) => {
        const lineNum = String(lineStart + i).padStart(3, ' ');
        console.log(`      ${lineNum} + ${line}`);
      });
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`Added ${added.length} line${added.length > 1 ? 's' : ''}`);
    if (removed.length > 0)
      parts.push(`removed ${removed.length} line${removed.length > 1 ? 's' : ''}`);
    if (parts.length > 0) {
      this.appendAssistantStyled(t`${fg(theme.muted)(parts.join(', '))}`);
    }
  }

  thinking(text: string): void {
    this.appendStyled(t`${fg(theme.white)('\u25CF')} ${fg(theme.muted)(text)}`);
  }

  image(source: string, sizeKB: number, output?: string): void {
    this._stepAction('Image', `${source}, ${sizeKB}KB`, output);
  }

  imageResult(): void {
    const result = t`${fg(theme.success)('\u2713 Ready')}`;
    if (this.pendingAction) {
      this._endAction(this._mergeStyled(this.pendingAction, t` `, result));
    } else {
      this._endAction(result);
    }
  }

  connector(source: string, action: string, output?: string): void {
    const sourceName = source.charAt(0).toUpperCase() + source.slice(1);
    this._stepAction(sourceName, action, output);
  }

  connectorResult(msg: string): void {
    const result = t`${fg(theme.muted)(msg)}`;
    if (this.pendingAction) {
      this._endAction(this._mergeStyled(this.pendingAction, t` `, result));
    } else {
      this._endAction(result);
    }
  }

  say(msg: string): void {
    this.appendAssistantStyled(t`${fg(theme.primary)('\u25CB')} ${fg(theme.accent)('Say')}()`);
  }

  heartbeat(mode: string = 'reflection'): void {
    this._stepAction('Heartbeat', mode);
  }

  heartbeatResult(_isOk: boolean): void {
    // No-op, same as old behavior
  }

  heartbeatUpdate(): void {
    this._stepAction('HeartbeatUpdate', 'HEARTBEAT.md');
  }

  heartbeatUpdateResult(success: boolean): void {
    const result = success
      ? t`${fg(theme.success)('\u2713 Updated HEARTBEAT.md')}`
      : t`${fg(theme.error)('\u2717 Failed to update HEARTBEAT.md')}`;
    if (this.pendingAction) {
      this._endAction(this._mergeStyled(this.pendingAction, t` `, result));
    } else {
      this._endAction(result);
    }
  }

  end(): void {
    // No-op
  }

  // === Color output helpers (replaces c.* usage in command handlers) ===

  violet(text: string, opts?: { bold?: boolean }): void {
    if (opts?.bold) {
      this.appendStyled(t`${bold(fg(theme.accent)(text))}`);
    } else {
      this.appendStyled(t`${fg(theme.accent)(text)}`);
    }
  }

  muted(text: string): void {
    this.appendAssistantStyled(t`${fg(theme.muted)(text)}`);
  }

  info(text: string): void {
    this.appendStyled(t`${fg(theme.info)(text)}`);
  }

  errorText(text: string): void {
    this.appendAssistantStyled(t`${fg(theme.error)(text)}`);
  }

  successText(text: string): void {
    this.appendStyled(t`${fg(theme.success)(text)}`);
  }

  warningText(text: string): void {
    this.appendStyled(t`${fg(theme.warning)(text)}`);
  }

  boldText(text: string): void {
    this.appendStyled(t`${bold(text)}`);
  }

  // === Block helpers ===

  errorBlock(msg: string): void {
    this.appendStyled(t`${bold(fg(theme.error)('[ERROR]'))} ${fg(theme.error)(msg)}`);
  }

  successBlock(msg: string): void {
    this.appendStyled(t`${bold(fg(theme.success)('[OK]'))} ${fg(theme.success)(msg)}`);
  }

  // === Thinking/Spinner ===

  showSpinner(label: string): void {
    if (this.tui) {
      this.tui.showSpinner(label);
    }
  }

  hideSpinner(): void {
    if (this.tui) {
      this.tui.hideSpinner();
    }
  }

  startThinking(label: string): void {
    this.thinkingStartTime = Date.now();
    this.showSpinner(label);
  }

  stopThinking(): string {
    this.hideSpinner();
    return this.formatDuration(Date.now() - this.thinkingStartTime);
  }

  // === Comm panel passthrough ===

  logPrompt(text: string): void {
    this.tui?.logPrompt(text);
  }

  logResponse(chunk: string): void {
    this.tui?.logResponse(chunk);
  }

  endResponse(): void {
    this.tui?.endResponse();
  }

  logAction(action: string): void {
    this.tui?.logAction(action);
  }

  logConnectorIn(src: string, msg: string): void {
    this.tui?.logConnectorIn(src, msg);
  }

  logConnectorOut(src: string, msg: string): void {
    this.tui?.logConnectorOut(src, msg);
  }

  // === Thinking stream (replaces thinkingDisplay) ===

  setThinkingCallback(callback: ((chunk: string) => void) | null): void {
    this.thinkingCallback = callback;
  }

  startThinkingStream(): void {
    // In TUI mode, thinking content goes to comm panel automatically
  }

  streamThinkingChunk(chunk: string): void {
    if (this.thinkingCallback) {
      this.thinkingCallback(chunk);
      return;
    }
    this.tui?.appendThinking(chunk);
  }

  endThinkingStream(): void {
    // In TUI mode, comm panel accumulates (no close needed)
  }

  // === Status ===

  statusLine(action: string, elapsed?: string, tokens?: number, thinkTime?: string): void {
    this.newline();
    this.scrollToBottom();
    const parts = [`\u25A3 ${action}`];
    if (elapsed) parts.push(elapsed);
    if (tokens) parts.push(`\u2193 ${tokens} tokens`);
    if (thinkTime) parts.push(`thought for ${thinkTime}`);
    this.muted(parts.join(' \u00B7 '));
  }

  buildStatus(success: boolean, errors?: string[]): void {
    if (success) {
      this.appendStyled(t`${fg(theme.success)('\u2713 Build OK')}`);
    } else {
      this.appendStyled(t`${fg(theme.error)('\u2717 Build failed')}`);
      if (errors) {
        errors.forEach(e => {
          this.muted(`  ${e}`);
        });
      }
    }
  }

  // === Markdown rendering (replaces say/executors.ts renderMarkdown) ===

  renderMarkdown(text: string, bordered = false): void {
    // When bordered + TUI: render all lines inside a single bordered block
    if (bordered && this.tui) {
      this.tui.startAssistantBlock();

      const lines = text.split('\n');
      let inCodeBlock = false;
      let codeBlockLang = '';
      let codeBlockLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('```')) {
          if (!inCodeBlock) {
            inCodeBlock = true;
            codeBlockLang = line.slice(3).trim();
            codeBlockLines = [];
          } else {
            const content = codeBlockLines.join('\n');
            this.tui.addAssistantBlockCode(content, codeBlockLang || undefined);
            inCodeBlock = false;
            codeBlockLang = '';
            codeBlockLines = [];
          }
          continue;
        }

        if (inCodeBlock) {
          codeBlockLines.push(line);
          continue;
        }

        if (line.startsWith('### ')) {
          this.tui.appendAssistantBlockLine(t`${bold(fg(theme.accent)(line))}`);
        } else if (line.startsWith('## ')) {
          this.tui.appendAssistantBlockLine(t`${bold(fg(theme.primary)(line))}`);
        } else if (line.startsWith('# ')) {
          this.tui.appendAssistantBlockLine(t`${bold(fg(theme.accent)(line))}`);
        } else if (line.startsWith('> ')) {
          this.tui.appendAssistantBlockLine(t`${fg(theme.muted)('\u2502 ' + line.slice(2))}`);
        } else if (/^[-*] /.test(line)) {
          this.tui.appendAssistantBlockLine(t`${fg(theme.primary)('\u2022')} ${line.slice(2)}`);
        } else {
          this.tui.appendAssistantBlockLine(t`${fg(theme.white)(line)}`);
        }
      }

      if (inCodeBlock && codeBlockLines.length > 0) {
        const content = codeBlockLines.join('\n');
        this.tui.addAssistantBlockCode(content, codeBlockLang || undefined);
      }

      this.tui.endAssistantBlock();
      return;
    }

    // Non-bordered or console fallback
    const appendLine = bordered
      ? (content: StyledText | string) => this.appendAssistantStyled(content)
      : (content: StyledText | string) => this.appendStyled(content);
    const appendPlain = bordered
      ? (text: string) => this.appendAssistant(text)
      : (text: string) => this.append(text);

    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.slice(3).trim();
          codeBlockLines = [];
        } else {
          const content = codeBlockLines.join('\n');
          console.log(content);
          inCodeBlock = false;
          codeBlockLang = '';
          codeBlockLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      if (line.startsWith('### ')) {
        appendLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('## ')) {
        appendLine(t`${bold(fg(theme.primary)(line))}`);
      } else if (line.startsWith('# ')) {
        appendLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('> ')) {
        appendLine(t`${fg(theme.muted)('\u2502 ' + line.slice(2))}`);
      } else if (/^[-*] /.test(line)) {
        appendLine(t`${fg(theme.primary)('\u2022')} ${line.slice(2)}`);
      } else {
        appendPlain(line);
      }
    }

    if (inCodeBlock && codeBlockLines.length > 0) {
      const content = codeBlockLines.join('\n');
      console.log(content);
    }

    if (!bordered) {
      this.newline();
    }
  }

  // === Say result display (replaces process.stdout.write for say actions) ===

  sayResult(msg: string): void {
    this.scrollToBottom();
    this.renderMarkdown(msg, true);
  }

  // === Prompt confirmation (y/n) ===

  async promptConfirmation(message: string): Promise<boolean> {
    if (this.tui) {
      const answer = await this.tui.promptInput(`${message} (y/n)`);
      return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
    } else {
      // Fallback to console readline
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise(resolve => {
        rl.question(`${message} (y/n) `, answer => {
          rl.close();
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });
    }
  }

  // === Private helpers ===

  private _mergeStyled(...parts: StyledText[]): StyledText {
    return { chunks: parts.flatMap(p => p.chunks) } as StyledText;
  }

  private _startAction(content: StyledText): void {
    this.pendingAction = content;
    this.tui?.startAction(content);
  }

  private _endAction(content: StyledText): void {
    if (this.pendingAction && this.tui) {
      this.tui.completeAction(content);
    } else {
      this.appendAssistantStyled(content);
    }
    this.pendingAction = null;
  }

  private _appendActionContent(content: StyledText): void {
    if (this.tui) {
      this.tui.appendActionContent(content);
    } else {
      const plain = content.chunks.map(c => c.text).join('');
      console.log(`  ${plain}`);
    }
  }

  private _stepAction(name: string, param: string, output?: string): void {
    const actionText = t`${bold(fg(theme.accent)(name))} ${fg(theme.muted)('-')} ${param}`;
    if (output !== undefined) {
      this._startAction(actionText);
      output.split('\n').forEach(line => {
        this._appendActionContent(t`${fg(theme.muted)(line)}`);
      });
      this._endAction(actionText);
    } else {
      this._startAction(actionText);
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    }
    return `${ms}ms`;
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  showNotification(text: string): void {
    if (this.tui) {
      this.tui.showNotification(text);
    }
  }

  updateNotificationList(items: { id: string; content: string; status: string }[]): void {
    if (this.tui) {
      this.tui.updateNotificationList(items);
    }
  }
}

export const display = new DisplayService();

// === Banner (absorbed from components/banner.ts) ===

// ANSI escape codes for CLI-mode banner rendering
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const ANSI = {
  primary: `${ESC}38;2;250;178;131m`, // #fab283 warm amber
  accent: `${ESC}38;2;157;124;216m`, // #9d7cd8 violet
  secondary: `${ESC}38;2;92;156;245m`, // #5c9cf5 blue
  green: `${ESC}38;2;127;216;143m`, // #7fd88f
  red: `${ESC}38;2;224;108;117m`, // #e06c75
  muted: `${ESC}38;2;110;110;110m`, // #6e6e6e
  white: `${ESC}38;2;212;212;212m`, // #d4d4d4
  bold: `${ESC}1m`,
  reset: RESET,
};

export interface BannerOptions {
  version?: string;
  workingDir?: string;
  contextFile?: string | null;
  tasksCount?: number;
  telegram?: boolean;
  discord?: boolean;
  voice?: boolean;
  heartbeat?: boolean;
  wallet?: boolean;
  cookTime?: number;
}

export function banner(options: BannerOptions = {}): string {
  const {
    version = 'v1.0.0',
    workingDir,
    contextFile,
    tasksCount = 0,
    telegram,
    discord,
    voice,
    heartbeat,
    wallet,
    cookTime,
  } = options;
  const cwd = workingDir || process.cwd();
  const shortCwd = cwd.replace(process.env.HOME || '', '~');

  // Build status badges
  const badges: string[] = [];
  if (telegram) badges.push(`${ANSI.green}\u25CF${ANSI.reset} ${ANSI.muted}Telegram${ANSI.reset}`);
  if (discord) badges.push(`${ANSI.green}\u25CF${ANSI.reset} ${ANSI.muted}Discord${ANSI.reset}`);
  if (voice) badges.push(`${ANSI.green}\u25CF${ANSI.reset} ${ANSI.muted}Voice${ANSI.reset}`);
  // Heartbeat: green if active, red if inactive
  const hbColor = heartbeat ? ANSI.green : ANSI.red;
  badges.push(`${hbColor}\u25CF${ANSI.reset} ${ANSI.muted}Heartbeat${ANSI.reset}`);
  // Wallet: green if unlocked, grey if locked
  const walletColor = wallet ? ANSI.green : ANSI.muted;
  badges.push(`${walletColor}\u25CF${ANSI.reset} ${ANSI.muted}Wallet${ANSI.reset}`);
  const statusLine = badges.length > 0 ? badges.join('  ') : '';

  // Skull logo
  const logoLines = [
    `${ANSI.accent} \u2584\u2584\u2584\u2584\u2584\u2584\u2584 ${ANSI.reset}`,
    `${ANSI.accent}\u2590\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u258C${ANSI.reset}`,
    `${ANSI.accent}\u2590\u2591\u2580\u2591\u2591\u2591\u2580\u2591\u258C${ANSI.reset}`,
    `${ANSI.accent}\u2590\u2591\u2591\u2591\u2584\u2591\u2591\u2591\u258C${ANSI.reset}`,
    `${ANSI.accent}\u2590\u2591\u2591\u2580\u2580\u2580\u2591\u2591\u258C${ANSI.reset}`,
    `${ANSI.accent} \u2580\u2580\u2580\u2580\u2580\u2580\u2580 ${ANSI.reset}`,
  ].slice(0, 5);

  const infoLines = [
    `${ANSI.white}${ANSI.bold}Slashbot${ANSI.reset} ${ANSI.accent}${version}${ANSI.reset}`,
    `${ANSI.muted}${shortCwd}${ANSI.reset}`,
    contextFile ? `${ANSI.muted}Context: ${contextFile}${ANSI.reset}` : '',
    statusLine,
    tasksCount > 0 ? `${ANSI.muted}${tasksCount} scheduled task(s)${ANSI.reset}` : '',
    `${ANSI.muted}? help \u00B7 Tab complete${ANSI.reset}`,
  ].filter(line => line !== '');

  let result = '\n';
  for (let i = 0; i < Math.max(logoLines.length, infoLines.length); i++) {
    const logoLine = logoLines[i] || '         ';
    const infoLine = infoLines[i] || '';
    result += `${logoLine}  ${infoLine}\n`;
  }

  // Add border
  const width = Math.min(process.stdout.columns || 80, 60);
  result += `${ANSI.muted}${'\u2500'.repeat(width)}${ANSI.reset}\n`;

  // Add cook time if provided
  if (cookTime !== undefined) {
    result += `${ANSI.muted}Cooked for ${cookTime}s${ANSI.reset}\n`;
  }

  return result;
}
