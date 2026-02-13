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
import { AsyncLocalStorage } from 'async_hooks';
import { theme } from './theme';
import type { UIOutput } from './types';
import { formatToolAction } from './format';
import { formatInlineDisplayValue } from './valueFormat';

import { isAssistantToolTranscript, parseAssistantToolTranscript } from './toolTranscript';
import { isExploreToolName } from './exploreTools';

export interface TUISpinnerCallbacks {
  showSpinner: (label: string, tabId?: string) => void;
  hideSpinner: (tabId?: string) => void;
}

// Static TUI callbacks - set once when TUI is initialized
let tuiSpinnerCallbacks: TUISpinnerCallbacks | null = null;

export function setTUISpinnerCallbacks(callbacks: TUISpinnerCallbacks | null): void {
  tuiSpinnerCallbacks = callbacks;
}

type ExploreEvent = {
  tool: string;
  success: boolean;
  total: number;
  preview: string[];
  meta?: string;
  sequence: number;
};

class DisplayService {
  private tui: UIOutput | null = null;
  private thinkingStartTime = 0;
  private thinkingCallback: ((chunk: string, tabId?: string) => void) | null = null;
  private readonly outputTabScope = new AsyncLocalStorage<{ tabId?: string }>();
  private readonly exploreLiveKey = 'explore-live';
  private readonly globalExploreKey = '__global__';
  private readonly exploreAnimationDelayMs = 90;
  private readonly exploreEventsByTab = new Map<string, ExploreEvent[]>();
  private readonly explorePendingByTab = new Map<string, ExploreEvent[]>();
  private readonly exploreTimersByTab = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly exploreSequenceByTab = new Map<string, number>();

  bindTUI(tui: UIOutput): void {
    this.tui = tui;
  }

  unbindTUI(): void {
    this.tui = null;
  }

  withOutputTab<T>(tabId: string | undefined, fn: () => T): T {
    if (!tabId) {
      return fn();
    }
    return this.outputTabScope.run({ tabId }, fn);
  }

  private resolveTabId(tabId?: string): string | undefined {
    return tabId || this.outputTabScope.getStore()?.tabId;
  }

  private exploreKey(tabId?: string): string {
    return this.resolveTabId(tabId) || this.globalExploreKey;
  }

  private getExploreEvents(tabId?: string): ExploreEvent[] {
    const key = this.exploreKey(tabId);
    let events = this.exploreEventsByTab.get(key);
    if (!events) {
      events = [];
      this.exploreEventsByTab.set(key, events);
    }
    return events;
  }

  private clearExploreEvents(tabId?: string): void {
    const key = this.exploreKey(tabId);
    this.exploreEventsByTab.delete(key);
  }

  private clearExplorePending(tabId?: string): void {
    const key = this.exploreKey(tabId);
    this.explorePendingByTab.delete(key);
    const timer = this.exploreTimersByTab.get(key);
    if (timer) {
      clearTimeout(timer);
      this.exploreTimersByTab.delete(key);
    }
  }

  private nextExploreSequence(tabId?: string): number {
    const key = this.exploreKey(tabId);
    const next = (this.exploreSequenceByTab.get(key) || 0) + 1;
    this.exploreSequenceByTab.set(key, next);
    return next;
  }

  private appendExploreEvent(event: ExploreEvent, tabId?: string): void {
    const events = this.getExploreEvents(tabId);
    events.push(event);
    if (!this.tui) return;
    this.tui.upsertAssistantMarkdownBlock(
      this.exploreLiveKey,
      this.buildExploreSummaryText(tabId),
      tabId,
    );
  }

  private drainExploreQueue(tabId?: string): void {
    const key = this.exploreKey(tabId);
    if (this.exploreTimersByTab.has(key)) {
      return;
    }

    const run = () => {
      const pending = this.explorePendingByTab.get(key);
      if (!pending || pending.length === 0) {
        this.explorePendingByTab.delete(key);
        this.exploreTimersByTab.delete(key);
        return;
      }

      const event = pending.shift()!;
      this.appendExploreEvent(event, tabId);

      const timer = setTimeout(() => {
        this.exploreTimersByTab.delete(key);
        this.drainExploreQueue(tabId);
      }, this.exploreAnimationDelayMs);
      this.exploreTimersByTab.set(key, timer);
    };

    run();
  }

  // === Core output ===

  /**
   * Append a plain message (no assistant border).
   * Replaces: append, appendStyled
   */
  appendMessage(content: StyledText | string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (this.tui) {
      if (typeof content === 'string') {
        this.tui.appendChat(content, targetTabId);
      } else {
        this.tui.appendStyledChat(content, targetTabId);
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
   */
  appendAssistantMessage(content: StyledText | string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (this.tui) {
      this.tui.appendAssistantChat(content, targetTabId);
    } else {
      const plain =
        typeof content === 'string'
          ? this.stripAnsi(content)
          : content.chunks.map(c => c.text).join('');
      console.log(`\x1b[38;2;157;124;216m\u2503\x1b[0m ${plain}`);
    }
  }

  appendAssistantMarkdown(text: string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (this.tui) {
      this.tui.appendAssistantMarkdown(text, targetTabId);
      return;
    }
    this.appendAssistantMessage(text, targetTabId);
  }

  appendDiffBlock(diff: string, filetype?: string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (this.tui) {
      this.tui.appendDiffBlock(diff, filetype, targetTabId);
      return;
    }
    this.appendAssistantMessage(diff, targetTabId);
  }

  // === Legacy aliases (avoid touching 100+ callers in commands) ===

  append(text: string, tabId?: string): void {
    this.appendMessage(text, tabId);
  }

  appendUserMessage(content: string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (this.tui) {
      this.tui.appendUserChat(content, targetTabId);
    } else {
      console.log(`[you] ${this.stripAnsi(content)}`);
    }
  }

  formatInline(value: unknown): string {
    return formatInlineDisplayValue(value);
  }

  beginUserTurn(tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    const key = this.exploreKey(targetTabId);
    this.exploreSequenceByTab.delete(key);
    this.clearExplorePending(targetTabId);
    this.clearExploreEvents(targetTabId);
    if (this.tui) {
      this.tui.removeAssistantMarkdownBlock(this.exploreLiveKey, targetTabId);
    }
  }

  endUserTurn(tabId?: string): void {
    // Keep the final live explore block visible after the turn ends.
    // It will be cleared at the beginning of the next user turn.
    void tabId;
  }

  pushExploreProbe(
    tool: string,
    payload: string,
    success: boolean,
    meta?: string,
    tabId?: string,
  ): void {
    const targetTabId = this.resolveTabId(tabId);
    const lines = (payload || '')
      .split('\n')
      .map(l => l.trim())
      .map(l => l.replace(/^\[[✓✗]\]\s*/, ''))
      .filter(Boolean);
    const preview = lines.slice(-5);
    const event: ExploreEvent = {
      tool: tool.trim() || 'Explore',
      success,
      total: lines.length,
      preview,
      meta,
      sequence: this.nextExploreSequence(targetTabId),
    };

    if (!this.tui) {
      this.appendExploreEvent(event, targetTabId);
      return;
    }

    const key = this.exploreKey(targetTabId);
    const pending = this.explorePendingByTab.get(key) || [];
    pending.push(event);
    this.explorePendingByTab.set(key, pending);
    this.drainExploreQueue(targetTabId);
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
    this.appendAssistantMessage(t`${fg(theme.info)(text)}`);
  }

  errorText(text: string): void {
    this.appendAssistantMessage(t`${fg(theme.error)(text)}`);
  }

  successText(text: string, tabId?: string): void {
    this.appendAssistantMessage(t`${fg(theme.success)(text)}`, tabId);
  }

  warningText(text: string): void {
    this.appendAssistantMessage(t`${fg(theme.warning)(text)}`);
  }

  // === Block helpers ===

  errorBlock(msg: string): void {
    this.appendAssistantMessage(t`${bold(fg(theme.error)('[ERROR]'))} ${fg(theme.error)(msg)}`);
  }

  // === Thinking/Spinner ===

  showSpinner(label: string, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (tuiSpinnerCallbacks) {
      tuiSpinnerCallbacks.showSpinner(label, targetTabId);
      return;
    }
    if (this.tui) {
      this.tui.showSpinner(label);
    }
  }

  hideSpinner(tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    if (tuiSpinnerCallbacks) {
      tuiSpinnerCallbacks.hideSpinner(targetTabId);
      return;
    }
    if (this.tui) {
      this.tui.hideSpinner();
    }
  }

  startThinking(label: string): void {
    this.thinkingStartTime = Date.now();
    this.showSpinner(label, this.resolveTabId());
  }

  stopThinking(): string {
    this.hideSpinner(this.resolveTabId());
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
    const targetTabId = this.resolveTabId();
    if (tuiSpinnerCallbacks) {
      const compact = action.replace(/\s+/g, ' ').trim();
      const label =
        compact.length === 0
          ? 'Working...'
          : `Working: ${compact.length > 72 ? `${compact.slice(0, 69)}...` : compact}`;
      tuiSpinnerCallbacks.showSpinner(label, targetTabId);
    }
    this.tui?.logAction(action);
  }

  logConnectorIn(src: string, msg: string): void {
    this.tui?.logConnectorIn(src, msg);
  }

  logConnectorOut(src: string, msg: string): void {
    this.tui?.logConnectorOut(src, msg);
  }

  // === Thinking stream (replaces thinkingDisplay) ===

  setThinkingCallback(callback: ((chunk: string, tabId?: string) => void) | null): void {
    this.thinkingCallback = callback;
  }

  startThinkingStream(): void {
    // In TUI mode, thinking content goes to comm panel automatically
  }

  streamThinkingChunk(chunk: string): void {
    const targetTabId = this.resolveTabId();
    if (this.thinkingCallback) {
      this.thinkingCallback(chunk, targetTabId);
      return;
    }
    this.tui?.appendThinking(chunk, targetTabId);
  }

  endThinkingStream(): void {
    // In TUI mode, comm panel accumulates (no close needed)
  }

  // === Markdown rendering ===

  renderMarkdown(text: string, bordered = false, tabId?: string): void {
    const targetTabId = this.resolveTabId(tabId);
    // When bordered + TUI: use self-contained appendAssistantMarkdown
    if (bordered && this.tui) {
      this.tui.appendAssistantMarkdown(text, targetTabId);
      return;
    }

    // Non-bordered or console fallback
    const appendLine = bordered
      ? (content: StyledText | string) => this.appendAssistantMessage(content, tabId)
      : (content: StyledText | string) => this.appendMessage(content, tabId);
    const appendPlain = bordered
      ? (text: string) => this.appendAssistantMessage(text, tabId)
      : (text: string) => this.appendMessage(text, tabId);

    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];
    const flushCodeBlock = () => {
      if (codeBlockLines.length === 0) return;
      if (codeBlockLang) {
        appendLine(t`${fg(theme.muted)(`[${codeBlockLang}]`)}`);
      }
      for (const codeLine of codeBlockLines) {
        appendLine(t`${fg(theme.secondary)(codeLine)}`);
      }
      codeBlockLang = '';
      codeBlockLines = [];
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.slice(3).trim();
          codeBlockLines = [];
        } else {
          flushCodeBlock();
          inCodeBlock = false;
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
        appendLine(t`${fg(theme.muted)('> ' + line.slice(2))}`);
      } else if (/^[-*] /.test(line)) {
        appendLine(t`${fg(theme.muted)('- ' + line.slice(2))}`);
      } else {
        appendPlain(line);
      }
    }

    if (inCodeBlock) {
      flushCodeBlock();
    }

    if (!bordered) {
      this.newline();
    }
  }

  /**
   * Render legacy assistant tool transcript blocks (e.g. "[tool] [git_status] ...")
   * into concise, styled assistant rows.
   */
  renderAssistantTranscript(text: string): boolean {
    if (!isAssistantToolTranscript(text)) {
      return false;
    }
    const entries = parseAssistantToolTranscript(text);
    if (entries.length === 0) {
      return false;
    }

    const isControlToolName = (toolName: string): boolean => {
      const normalized = toolName
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
      return (
        normalized === 'saymessage' || normalized === 'endtask' || normalized === 'continuetask'
      );
    };

    for (const entry of entries) {
      const targetTabId = this.resolveTabId();
      if (entry.kind === 'tool') {
        if (isControlToolName(entry.toolName)) {
          continue;
        }
        if (isExploreToolName(entry.toolName)) {
          const detail = entry.detail || 'completed';
          if (entry.success ?? true) {
            this.pushExploreProbe(entry.toolName, detail, true, undefined, targetTabId);
            continue;
          }
          this.appendAssistantMessage(
            formatToolAction(entry.toolName, detail, {
              success: false,
            }),
            targetTabId,
          );
          continue;
        }
        this.appendAssistantMessage(
          formatToolAction(entry.toolName, entry.detail, {
            success: entry.success ?? true,
          }),
          targetTabId,
        );
        continue;
      }

      if (entry.text.trim()) {
        this.appendAssistantMessage(entry.text, targetTabId);
      }
    }
    return true;
  }

  // === Say result display ===

  sayResult(msg: string, tabId?: string): void {
    this.renderMarkdown(msg, true, tabId);
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

  private buildExploreSummaryText(tabId?: string): string {
    const events = [...(this.exploreEventsByTab.get(this.exploreKey(tabId)) || [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
    const probes = events.length;
    const totalLines = events.reduce((sum, item) => sum + item.total, 0);
    const success = events.every(item => item.success);
    const allRows = events.flatMap(item => {
      const suffix = item.meta ? ` (${item.meta})` : '';
      if (item.preview.length === 0) {
        return [`- #${item.sequence} ${item.tool}${suffix}: no matches`];
      }
      return item.preview.map(line => `- #${item.sequence} ${item.tool}${suffix}: ${line}`);
    });
    const previewRows = allRows.slice(-10);
    const hidden = Math.max(0, allRows.length - previewRows.length);

    const header = `Explore - ${probes} probe(s) ${success ? '✓' : '✗'} ${totalLines} lines`;
    if (previewRows.length === 0) {
      return `${header}\nLatest updates:\n- no matches`;
    }
    return `${header}\nLatest updates:\n${previewRows.join('\n')}${
      hidden > 0 ? `\n- ... +${hidden} older update(s)` : ''
    }`;
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
