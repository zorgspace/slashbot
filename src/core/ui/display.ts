/**
 * DisplayService - Central UI output singleton
 *
 * Simplified API: appendAssistantMessage / appendMessage / appendUserMessage
 * plus convenience wrappers and spinner/thinking controls.
 *
 * Before bindTUI(): all output goes to console.log (plain text fallback).
 * After bindTUI(): all output renders natively in TUI with OpenTUI styled text.
 */

import { t, fg, bold, type StyledText } from '@opentui/core';
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

class DisplayService {
  private tui: UIOutput | null = null;
  private thinkingStartTime = 0;
  private thinkingCallback: ((chunk: string) => void) | null = null;

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

  /**
   * Append a plain message (no assistant border).
   * Replaces: append, appendStyled
   */
  appendMessage(content: StyledText | string): void {
    if (this.tui) {
      if (typeof content === 'string') {
        this.tui.appendChat(content);
      } else {
        this.tui.appendStyledChat(content);
      }
    } else {
      const plain =
        typeof content === 'string'
          ? this.stripAnsi(content)
          : content.chunks.map(c => c.text).join('');
      console.log(plain);
    }
  }

  /**
   * Append an assistant-bordered message (violet left border in TUI).
   * Replaces: appendAssistant, appendAssistantStyled
   */
  appendAssistantMessage(content: StyledText | string): void {
    if (this.tui) {
      this.tui.appendAssistantChat(content);
    } else {
      const plain =
        typeof content === 'string'
          ? this.stripAnsi(content)
          : content.chunks.map(c => c.text).join('');
      console.log(`\x1b[38;2;157;124;216m\u2503\x1b[0m ${plain}`);
    }
  }

  // === Legacy aliases (avoid touching 100+ callers in commands) ===

  append(text: string): void {
    this.appendMessage(text);
  }

  appendStyled(content: StyledText | string): void {
    this.appendMessage(content);
  }

  appendAssistant(text: string): void {
    this.appendAssistantMessage(text);
  }

  appendAssistantStyled(content: StyledText | string): void {
    this.appendAssistantMessage(content);
  }

  // === Convenience wrappers ===

  newline(): void {
    this.append('');
  }

  success(msg: string): void {
    this.appendAssistantMessage(t`${fg(theme.success)('\u2713 ' + msg)}`);
  }

  error(msg: string): void {
    this.appendAssistantMessage(t`${fg(theme.error)('Error: ' + msg)}`);
  }

  warning(msg: string): void {
    this.appendAssistantMessage(t`${fg(theme.warning)('\u26A0 ' + msg)}`);
  }

  violet(text: string, opts?: { bold?: boolean }): void {
    if (opts?.bold) {
      this.appendMessage(t`${bold(fg(theme.accent)(text))}`);
    } else {
      this.appendMessage(t`${fg(theme.accent)(text)}`);
    }
  }

  muted(text: string): void {
    this.appendAssistantMessage(t`${fg(theme.muted)(text)}`);
  }

  info(text: string): void {
    this.appendMessage(t`${fg(theme.info)(text)}`);
  }

  errorText(text: string): void {
    this.appendAssistantMessage(t`${fg(theme.error)(text)}`);
  }

  successText(text: string): void {
    this.appendMessage(t`${fg(theme.success)(text)}`);
  }

  warningText(text: string): void {
    this.appendMessage(t`${fg(theme.warning)(text)}`);
  }

  boldText(text: string): void {
    this.appendMessage(t`${bold(text)}`);
  }

  // === Block helpers ===

  errorBlock(msg: string): void {
    this.appendMessage(t`${bold(fg(theme.error)('[ERROR]'))} ${fg(theme.error)(msg)}`);
  }

  successBlock(msg: string): void {
    this.appendMessage(t`${bold(fg(theme.success)('[OK]'))} ${fg(theme.success)(msg)}`);
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

  // === Markdown rendering ===

  renderMarkdown(text: string, bordered = false): void {
    // When bordered + TUI: use self-contained appendAssistantMarkdown
    if (bordered && this.tui) {
      this.tui.appendAssistantMarkdown(text);
      return;
    }

    // Non-bordered or console fallback
    const appendLine = bordered
      ? (content: StyledText | string) => this.appendAssistantMessage(content)
      : (content: StyledText | string) => this.appendMessage(content);
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

  // === Say result display ===

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
