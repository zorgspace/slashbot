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
import type { TUIApp } from './TUIApp';

export interface TUISpinnerCallbacks {
  showSpinner: (label: string) => void;
  hideSpinner: () => void;
}

// Static TUI callbacks - set once when TUI is initialized
let tuiSpinnerCallbacks: TUISpinnerCallbacks | null = null;

export function setTUISpinnerCallbacks(callbacks: TUISpinnerCallbacks | null): void {
  tuiSpinnerCallbacks = callbacks;
}

class DisplayService {
  private tui: TUIApp | null = null;
  private thinkingStartTime = 0;
  private thinkingCallback: ((chunk: string) => void) | null = null;

  bindTUI(tui: TUIApp): void {
    this.tui = tui;
  }

  unbindTUI(): void {
    this.tui = null;
  }

  // === Core output ===

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
      // Fallback: plain text (strip ANSI codes to avoid garbled output)
      const plain = this.stripAnsi(String(content));
      console.log(plain);
    }
  }

  // === Step methods (replaces step.* from display/step.ts) ===

  newline(): void {
    this.append('');
  }

  message(text: string): void {
    this.appendStyled(t`${fg(theme.violet)('●')} ${text}`);
    this.newline();
  }

  tool(name: string, args?: string): void {
    this.newline();
    const argsStr = args ? `(${args})` : '';
    this.appendStyled(t`${fg(theme.violet)('●')} ${fg(theme.violet)(name)}${argsStr}`);
  }

  result(text: string, isError = false): void {
    const isSuccess =
      text.includes('No errors') ||
      text.includes('success') ||
      text.includes('Created') ||
      text.includes('Updated');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const checkmark = i === 0 && isSuccess && !isError ? '✓ ' : '';
      const prefix = i === 0 ? '⎿  ' : '   ';
      if (isError) {
        this.appendStyled(t`  ${fg(theme.error)(prefix + checkmark + line)}`);
      } else if (isSuccess) {
        this.appendStyled(t`  ${fg(theme.success)(prefix + checkmark + line)}`);
      } else {
        this.appendStyled(t`  ${fg(theme.white)(prefix + checkmark + line)}`);
      }
    });
  }

  read(path: string, output?: string): void {
    this._stepAction('Read', path, output);
  }

  readResult(lineCount: number): void {
    this.appendStyled(t`  ${fg(theme.white)('⎿  Read ' + lineCount + ' lines')}`);
  }

  grep(pattern: string, filePattern?: string, output?: string): void {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    this._stepAction('Grep', args, output);
  }

  grepResult(matches: number, preview?: string): void {
    if (matches === 0) {
      this.appendStyled(t`  ${fg(theme.white)('⎿  No matches found')}`);
    } else {
      this.appendStyled(
        t`  ${fg(theme.white)('⎿  Found ' + matches + ' match' + (matches > 1 ? 'es' : ''))}`,
      );
      if (preview) {
        preview.split('\n').forEach(line => {
          this.appendStyled(t`     ${fg(theme.white)(line)}`);
        });
      }
    }
  }

  bash(command: string, output?: string): void {
    this._stepAction('Exec', command, output);
  }

  bashResult(_command: string, output: string, exitCode = 0): void {
    const isError = exitCode !== 0 || output.startsWith('Error:');
    const isSuccess =
      output.includes('No errors') || output.includes('success') || output.includes('✓');
    if (isError) {
      this.appendStyled(t`  ${fg(theme.error)('⎿  Exit code ' + exitCode)}`);
    } else if (isSuccess) {
      this.appendStyled(t`  ${fg(theme.success)('⎿  ✓ Done')}`);
    } else {
      this.appendStyled(t`  ${fg(theme.white)('⎿  Done')}`);
    }
  }

  update(path: string, output?: string): void {
    this._stepAction('Edit', path, output);
  }

  updateResult(success: boolean, _removed: number, _added: number): void {
    if (success) {
      this.appendStyled(t`  ${fg(theme.success)('⎿  Updated')}`);
    } else {
      this.appendStyled(t`  ${fg(theme.error)('⎿  Failed - pattern not found')}`);
    }
  }

  write(path: string, output?: string): void {
    this._stepAction('Create', path, output);
  }

  writeResult(success: boolean, lineCount?: number): void {
    if (success) {
      const info = lineCount ? ` (${lineCount} lines)` : '';
      this.appendStyled(t`  ${fg(theme.success)('⎿  Created' + info)}`);
    } else {
      this.appendStyled(t`  ${fg(theme.error)('⎿  Failed to create file')}`);
    }
  }

  schedule(name: string, cron: string, output?: string): void {
    this._stepAction('Schedule', `${name}, "${cron}"`, output);
  }

  skill(name: string, output?: string): void {
    this._stepAction('Skill', name, output);
  }

  success(msg: string): void {
    this.appendStyled(t`  ${fg(theme.success)('⎿  ✓ ' + msg)}`);
  }

  error(msg: string): void {
    this.appendStyled(t`  ${fg(theme.error)('⎿  Error: ' + msg)}`);
  }

  warning(msg: string): void {
    this.appendStyled(t`  ${fg(theme.warning)('⎿  ⚠ ' + msg)}`);
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
      this.appendStyled(t`      ${fg(theme.muted)(parts.join(', '))}`);
    }
  }

  thinking(text: string): void {
    this.appendStyled(t`${fg(theme.white)('●')} ${fg(theme.muted)(text)}`);
  }

  image(source: string, sizeKB: number, output?: string): void {
    this._stepAction('Image', `${source}, ${sizeKB}KB`, output);
  }

  imageResult(): void {
    this.appendStyled(t`  ${fg(theme.success)('⎿  Ready')}`);
  }

  connector(source: string, action: string, output?: string): void {
    const sourceName = source.charAt(0).toUpperCase() + source.slice(1);
    this._stepAction(sourceName, action, output);
  }

  connectorResult(msg: string): void {
    this.appendStyled(t`  ${fg(theme.white)('⎿  ' + msg)}`);
  }

  say(msg: string): void {
    this.appendStyled(t`${fg(theme.white)('○')} ${fg(theme.white)('Say')}()`);
    msg.split('\n').forEach((line, i) => {
      const prefix = i === 0 ? '⎿  ' : '   ';
      this.appendStyled(t`  ${fg(theme.white)(prefix + line)}`);
    });
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
    if (success) {
      this.appendStyled(t`  ${fg(theme.success)('⎿  Updated HEARTBEAT.md')}`);
    } else {
      this.appendStyled(t`  ${fg(theme.error)('⎿  Failed to update HEARTBEAT.md')}`);
    }
  }

  end(): void {
    // No-op
  }

  // === Color output helpers (replaces c.* usage in command handlers) ===

  violet(text: string, opts?: { bold?: boolean }): void {
    if (opts?.bold) {
      this.appendStyled(t`${bold(fg(theme.violet)(text))}`);
    } else {
      this.appendStyled(t`${fg(theme.violet)(text)}`);
    }
  }

  muted(text: string): void {
    this.appendStyled(t`${fg(theme.muted)(text)}`);
  }

  info(text: string): void {
    this.appendStyled(t`${fg(theme.violet)(text)}`);
  }

  errorText(text: string): void {
    this.appendStyled(t`${fg(theme.error)(text)}`);
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
    const parts = [`* ${action}`];
    if (elapsed) parts.push(elapsed);
    if (tokens) parts.push(`↓ ${tokens} tokens`);
    if (thinkTime) parts.push(`thought for ${thinkTime}`);
    this.muted(parts.join(' · '));
  }

  buildStatus(success: boolean, errors?: string[]): void {
    if (success) {
      this.appendStyled(t`${fg(theme.success)('✓ Build OK')}`);
    } else {
      this.appendStyled(t`${fg(theme.error)('✗ Build failed')}`);
      if (errors) {
        errors.forEach(e => {
          this.muted(`  ${e}`);
        });
      }
    }
  }

  // === Markdown rendering (replaces say/executors.ts renderMarkdown) ===

  renderMarkdown(text: string): void {
    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];

    for (const line of lines) {
      // Code fence open/close
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.slice(3).trim();
          codeBlockLines = [];
        } else {
          // Close code block - render with CodeRenderable or fallback
          const content = codeBlockLines.join('\n');
          if (this.tui) {
            this.tui.appendCodeBlock(content, codeBlockLang || undefined);
          } else {
            console.log(content);
          }
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

      // Headers
      if (line.startsWith('### ')) {
        this.appendStyled(t`${bold(fg(theme.violet)(line))}`);
      } else if (line.startsWith('## ')) {
        this.appendStyled(t`${bold(fg(theme.warning)(line))}`);
      } else if (line.startsWith('# ')) {
        this.appendStyled(t`${bold(fg(theme.violet)(line))}`);
      }
      // Blockquotes
      else if (line.startsWith('> ')) {
        this.appendStyled(t`${fg(theme.muted)('│ ' + line.slice(2))}`);
      }
      // List items
      else if (/^[-*] /.test(line)) {
        this.appendStyled(t`${fg(theme.violet)('•')} ${line.slice(2)}`);
      }
      // Regular text
      else {
        this.append(line);
      }
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockLines.length > 0) {
      const content = codeBlockLines.join('\n');
      if (this.tui) {
        this.tui.appendCodeBlock(content, codeBlockLang || undefined);
      } else {
        console.log(content);
      }
    }

    this.newline();
  }

  // === Say result display (replaces process.stdout.write for say actions) ===

  sayResult(msg: string): void {
    this.newline();
    this.appendStyled(t`${fg(theme.white)('●')} ${msg}`);
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

  private _stepAction(name: string, param: string, output?: string): void {
    this.newline();
    this.appendStyled(t`${fg(theme.violet)('●')} ${fg(theme.violet)(name)}(${param})`);
    if (output !== undefined) {
      output.split('\n').forEach((line, i) => {
        const prefix = i === 0 ? '⎿  ' : '   ';
        this.appendStyled(t`  ${fg(theme.white)(prefix + line)}`);
      });
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
}

export const display = new DisplayService();

// === Banner (absorbed from components/banner.ts) ===

// ANSI escape codes for CLI-mode banner rendering
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const ANSI = {
  violet: `${ESC}38;5;135m`,
  green: `${ESC}38;5;34m`,
  red: `${ESC}38;5;124m`,
  muted: `${ESC}38;5;244m`,
  white: `${ESC}38;5;255m`,
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
  if (telegram) badges.push(`${ANSI.green}●${ANSI.reset} ${ANSI.muted}Telegram${ANSI.reset}`);
  if (discord) badges.push(`${ANSI.green}●${ANSI.reset} ${ANSI.muted}Discord${ANSI.reset}`);
  if (voice) badges.push(`${ANSI.green}●${ANSI.reset} ${ANSI.muted}Voice${ANSI.reset}`);
  // Heartbeat: green if active, red if inactive
  const hbColor = heartbeat ? ANSI.green : ANSI.red;
  badges.push(`${hbColor}●${ANSI.reset} ${ANSI.muted}Heartbeat${ANSI.reset}`);
  // Wallet: green if unlocked, grey if locked
  const walletColor = wallet ? ANSI.green : ANSI.muted;
  badges.push(`${walletColor}●${ANSI.reset} ${ANSI.muted}Wallet${ANSI.reset}`);
  const statusLine = badges.length > 0 ? badges.join('  ') : '';

  // Skull logo
  const logoLines = [
    `${ANSI.violet} ▄▄▄▄▄▄▄ ${ANSI.reset}`,
    `${ANSI.violet}▐░░░░░░░▌${ANSI.reset}`,
    `${ANSI.violet}▐░▀░░░▀░▌${ANSI.reset}`,
    `${ANSI.violet}▐░░░▄░░░▌${ANSI.reset}`,
    `${ANSI.violet}▐░░▀▀▀░░▌${ANSI.reset}`,
    `${ANSI.violet} ▀▀▀▀▀▀▀ ${ANSI.reset}`,
  ];

  const infoLines = [
    `${ANSI.white}${ANSI.bold}Slashbot${ANSI.reset} ${ANSI.violet}${version}${ANSI.reset}`,
    `${ANSI.muted}Grok 4.1 · X.AI · ${shortCwd}${ANSI.reset}`,
    contextFile ? `${ANSI.muted}Context: ${contextFile}${ANSI.reset}` : '',
    statusLine,
    tasksCount > 0 ? `${ANSI.muted}${tasksCount} scheduled task(s)${ANSI.reset}` : '',
    `${ANSI.muted}? help · Tab complete${ANSI.reset}`,
  ].filter(line => line !== '');

  let result = '\n';
  for (let i = 0; i < Math.max(logoLines.length, infoLines.length); i++) {
    const logoLine = logoLines[i] || '         ';
    const infoLine = infoLines[i] || '';
    result += `${logoLine}  ${infoLine}\n`;
  }

  // Add border
  const width = Math.min(process.stdout.columns || 80, 60);
  result += `${ANSI.muted}${'─'.repeat(width)}${ANSI.reset}\n`;

  // Add cook time if provided
  if (cookTime !== undefined) {
    result += `${ANSI.muted}Cooked for ${cookTime}s${ANSI.reset}\n`;
  }

  return result;
}
