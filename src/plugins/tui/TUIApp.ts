/**
 * TUIApp - Main OpenTUI dashboard orchestrator
 *
 * Manages the full-screen layout with header (incl. status),
 * chat, communication log panel, and input area.
 */

import { createCliRenderer, BoxRenderable, type CliRenderer, type StyledText } from '@opentui/core';
import { theme } from '../../core/ui/theme';
import { display } from '../../core/ui/display';
import type { UIOutput, SidebarData, TUIAppCallbacks } from '../../core/ui/types';
import { buildUnifiedDiff } from '../../core/utils/diffBuilder';
import type { HeaderOptions } from './panels/HeaderPanel';
import { HeaderPanel } from './panels/HeaderPanel';
import { TabsPanel, type TabItem } from './panels/TabsPanel';
import { ChatPanel } from './panels/ChatPanel';
import { CommPanel } from './panels/CommPanel';
import { CommandPalettePanel } from './panels/CommandPalettePanel';
import { InputPanel } from './panels/InputPanel';
import { ThinkingPanel } from './panels/ThinkingPanel';

import { NotificationPanel } from './panels/TodoNotification';
import {
  enableBracketedPaste,
  disableBracketedPaste,
  storePaste,
  readImageFromClipboard,
  getLastPasteSummary,
  clearLastPaste,
} from './pasteHandler';
import { addImage, imageBuffer } from '../filesystem/services/ImageBuffer';
import { spawn } from 'child_process';

/**
 * Copy text to system clipboard using available tool (xclip, xsel, wl-copy, pbcopy)
 */
function copyToClipboard(text: string): void {
  const tools = [
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
    { cmd: 'wl-copy', args: [] },
    { cmd: 'pbcopy', args: [] },
  ];

  for (const tool of tools) {
    try {
      const proc = spawn(tool.cmd, tool.args, { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin.write(text);
      proc.stdin.end();
      proc.on('error', () => {});
      return;
    } catch {
      continue;
    }
  }
}

export class TUIApp implements UIOutput {
  private renderer!: CliRenderer;
  private headerPanel!: HeaderPanel;
  private tabsPanel!: TabsPanel;
  private chatPanel!: ChatPanel;
  private commPanel!: CommPanel;
  private commandPalette!: CommandPalettePanel;
  private inputPanel!: InputPanel;
  private thinkingPanel!: ThinkingPanel;

  private callbacks: TUIAppCallbacks;
  private completer?: (line: string) => [string[], string];
  private history: string[];
  private destroyed = false;
  private notificationPanel!: NotificationPanel;
  private lastCtrlC = 0;
  private lastSelectedText = '';
  private ignoreNextPaste = false;

  private tabBuffers: { [key: string]: any[] } = {};
  private tabInputDrafts: Record<string, string> = {};
  constructor(
    callbacks: TUIAppCallbacks,
    options?: {
      completer?: (line: string) => [string[], string];
      history?: string[];
    },
  ) {
    this.callbacks = callbacks;
    this.completer = options?.completer;
    this.history = options?.history || [];
  }

  async init(): Promise<void> {
    // Enable bracketed paste mode for proper input handling
    enableBracketedPaste();

    // Create renderer in inline mode (no alternate screen, preserves terminal history)
    // Starts at minimal height, grows as content is added
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
    });

    // Create root layout: vertical stack
    const root = new BoxRenderable(this.renderer, {
      id: 'root',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    });

    // Header panel (includes status indicators)
    this.headerPanel = new HeaderPanel(this.renderer);
    root.add(this.headerPanel.getRenderable());

    // Agents sidebar (select/create/edit/delete)
    this.tabsPanel = new TabsPanel(this.renderer, {
      onSelect: async (tabId, previousTabId) => {
        this.captureInputDraft(previousTabId);
        this.restoreInputDraft(tabId);
        try {
          await this.callbacks.onTabChange?.(tabId);
          const buffered = this.tabBuffers[tabId];
          if (buffered && buffered.length > 0) {
            this.renderTabHistory(tabId);
          }
        } catch (error) {
          this.captureInputDraft(tabId);
          this.restoreInputDraft(previousTabId);
          this.renderTabHistory(previousTabId);
          throw error;
        }
      },
      onCreateAgent: () => {
        this.callbacks.onCreateAgent?.();
      },
      onEditAgent: agentId => {
        this.callbacks.onEditAgent?.(agentId);
      },
      onDeleteAgent: agentId => {
        this.callbacks.onDeleteAgent?.(agentId);
      },
    });

    this.setActiveTab('agent-architect');

    // Content row: agents sidebar + main chat column + right diff panel
    const contentRow = new BoxRenderable(this.renderer, {
      id: 'content-row',
      flexDirection: 'row',
      flexGrow: 1,
    });

    // Left sidebar: agents list with scroll overflow
    contentRow.add(this.tabsPanel.getRenderable());

    // Left column: chat + comm panel
    const leftColumn = new BoxRenderable(this.renderer, {
      id: 'left-column',
      flexDirection: 'column',
      flexGrow: 1,
      justifyContent: 'flex-end',
      paddingLeft: 2,
      paddingRight: 2,
    });

    // Chat panel
    this.chatPanel = new ChatPanel(this.renderer);
    leftColumn.add(this.chatPanel.getRenderable());

    // Communication log panel (hidden by default, Ctrl+T to toggle)
    this.commPanel = new CommPanel(this.renderer);
    leftColumn.add(this.commPanel.getRenderable());

    contentRow.add(leftColumn);

    root.add(contentRow);

    // Command palette (hidden by default, shown on Tab with '/')
    this.commandPalette = new CommandPalettePanel(this.renderer);
    root.add(this.commandPalette.getRenderable());

    // Thinking panel (above input, hidden by default)
    this.thinkingPanel = new ThinkingPanel(this.renderer);
    root.add(this.thinkingPanel.getRenderable());

    // Notification panel (above input, hidden by default, auto-dismisses)
    this.notificationPanel = new NotificationPanel(this.renderer);
    root.add(this.notificationPanel.getRenderable());

    // Input panel
    this.inputPanel = new InputPanel(this.renderer, {
      onSubmit: async value => {
        this.appendUserChat(value);
        await this.callbacks.onInput(value);
      },
      completer: this.completer,
      history: this.history,
    });
    root.add(this.inputPanel.getRenderable());

    this.renderer.root.add(root);

    // Track selected text for middle-click paste (copy handled by terminal's native right-click menu)
    this.renderer.on('selection', () => {
      const sel = this.renderer.getSelection();
      if (sel) {
        const text = sel.getSelectedText();
        if (text) {
          this.lastSelectedText = text;
        }
      }
    });

    // Click anywhere: middle-click pastes last selection, right-click copies selection, any click focuses input
    root.onMouseDown = event => {
      // Right-click: copy selected text to system clipboard with visual blink
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        if (this.lastSelectedText) {
          copyToClipboard(this.lastSelectedText);
          // Flash background to confirm copy
          this.renderer.setBackgroundColor(theme.violet);
          setTimeout(() => this.renderer.setBackgroundColor(theme.transparent), 50);
        }
        return;
      }
      if (event.button === 1 && this.lastSelectedText) {
        this.inputPanel.insertText(this.lastSelectedText);
      }
      this.inputPanel.focus();
    };

    // Auto-focus input on startup
    this.inputPanel.focus();

    // Set up keyboard handlers via keyInput EventEmitter
    const keyHandler = this.renderer.keyInput;

    keyHandler.on('keypress', key => {
      // Ctrl+C - first press aborts current operation, second press exits
      if (key.ctrl && key.name === 'c' && !key.shift) {
        key.stopPropagation();
        key.preventDefault();
        this.inputPanel.cancelPrompt();
        const now = Date.now();
        if (now - this.lastCtrlC < 2000) {
          this.callbacks.onExit();
          return;
        }
        this.lastCtrlC = now;
        this.callbacks.onAbort({
          tabId: this.tabsPanel.getActiveTabId(),
          source: 'ctrl_c',
        });
        this.inputPanel.clear();
        this.appendChat('Press Ctrl+C again to exit');
        return;
      }

      // Ctrl+L - clear chat
      if (key.ctrl && key.name === 'l' && !key.shift) {
        key.stopPropagation();
        key.preventDefault();
        this.clearChat();
        return;
      }

      // Ctrl+T - toggle communication log
      if (key.ctrl && key.name === 't' && !key.shift) {
        key.stopPropagation();
        key.preventDefault();
        this.commPanel.toggle();
        return;
      }



      // Ctrl+V (without Shift) - image paste from clipboard
      if (key.ctrl && key.name === 'v' && !key.shift) {
        key.stopPropagation();
        key.preventDefault();
        // Ignore any bracketed paste event that may follow from the terminal
        this.ignoreNextPaste = true;
        setTimeout(() => {
          this.ignoreNextPaste = false;
        }, 200);
        readImageFromClipboard()
          .then(dataUrl => {
            if (dataUrl) {
              addImage(dataUrl);
              display.successText(`Image added to context #${imageBuffer.length}`);
            } else {
              display.warningText('No image in clipboard. Use Ctrl+Shift+V to paste text.');
            }
          })
          .catch(() => {
            display.warningText('Could not read image from clipboard.');
          });
        return;
      }

      // Escape - abort running work in active tab and clear prompt
      if (key.name === 'escape' && !key.ctrl && !key.shift) {
        const aborted = this.callbacks.onAbort({
          tabId: this.tabsPanel.getActiveTabId(),
          source: 'escape',
        });
        if (aborted) {
          key.stopPropagation();
          key.preventDefault();
          if (this.commandPalette.isVisible()) {
            this.commandPalette.hide();
          }
          this.inputPanel.clear();
          this.inputPanel.focus();
          return;
        }
      }

      // The following keys only apply when input is focused
      if (this.inputPanel.isFocused()) {
        // When a prompt (password/text) is active, let InputPanel handle everything
        if (this.inputPanel.isPromptActive()) {
          return;
        }

        // Enter - submit input
        if (key.name === 'return') {
          key.stopPropagation();
          key.preventDefault();
          const value = this.inputPanel.getValue();
          if (value.trim()) {
            this.appendUserChat(value);
            this.inputPanel.clear();
            this.callbacks.onInput(value);
          }
          return;
        }

        // Tab - command completion + palette
        if (key.name === 'tab' && !key.ctrl && !key.shift) {
          key.stopPropagation();
          key.preventDefault();
          const value = this.inputPanel.getValue();
          const matchCount = this.inputPanel.tabComplete();
          if (value.startsWith('/') && matchCount > 1) {
            // Show palette with current (post-completion) input as filter
            this.commandPalette.show(this.inputPanel.getValue());
          } else {
            this.commandPalette.hide();
          }
          return;
        }

        // Hide palette on Escape, or clear persistent paste when input is empty
        if (key.name === 'escape') {
          if (this.commandPalette.isVisible()) {
            key.stopPropagation();
            key.preventDefault();
            this.commandPalette.hide();
            return;
          }
          // Clear persistent paste when input is empty
          if (!this.inputPanel.getValue().trim() && getLastPasteSummary()) {
            key.stopPropagation();
            key.preventDefault();
            clearLastPaste();
            this.inputPanel.setPlaceholder(this.inputPanel.getDefaultPlaceholder());
            return;
          }
        }

        // Hide palette on any other key (non-Tab)
        if (this.commandPalette.isVisible()) {
          this.commandPalette.hide();
        }

        // Up arrow - history navigation
        if (key.name === 'up') {
          key.stopPropagation();
          key.preventDefault();
          this.inputPanel.historyUp();
          return;
        }

        // Down arrow - history navigation
        if (key.name === 'down') {
          key.stopPropagation();
          key.preventDefault();
          this.inputPanel.historyDown();
          return;
        }
      }
    });

    // Intercept paste events: compress pasted content into a placeholder
    keyHandler.on('paste', event => {
      if (!this.inputPanel.isFocused()) return;
      event.preventDefault();
      event.stopPropagation();
      // New paste replaces any persistent paste
      clearLastPaste();
      this.inputPanel.setPlaceholder(this.inputPanel.getDefaultPlaceholder());
      const placeholder = storePaste(event.text);
      this.inputPanel.insertText(placeholder);
    });

    // Bind display service so all styled output goes through TUI natively
    display.bindTUI(this);
  }

  // --- UIOutput interface ---

  setHeader(options: HeaderOptions): void {
    this.headerPanel.setOptions(options);
  }

  updateTabs(tabs: TabItem[], activeTabId: string): void {
    this.tabsPanel.setTabs(tabs, activeTabId);
  }

  setActiveTab(tabId: string): void {
    this.tabsPanel.setActiveTab(tabId);
  }

  getActiveTabId(): string {
    return this.tabsPanel.getActiveTabId();
  }

  private captureInputDraft(tabId: string): void {
    if (!tabId || !this.inputPanel) return;
    this.tabInputDrafts[tabId] = this.inputPanel.getValue();
  }

  private restoreInputDraft(tabId: string): void {
    if (!tabId || !this.inputPanel) return;
    this.inputPanel.setValue(this.tabInputDrafts[tabId] || '');
  }

  private renderTabHistory(tabId: string): void {
    this.chatPanel.clear();
    const buffer = this.tabBuffers[tabId] || [];
    for (const action of buffer) {
      const { method, args } = action as any;
      (this.chatPanel as any)[method](...args);
    }
    this.chatPanel.scrollToBottom();
  }

  private bufferAction(targetTabId: string, method: string, args: any[]): void {
    let buffer = this.tabBuffers[targetTabId];
    if (!buffer) {
      buffer = this.tabBuffers[targetTabId] = [];
    }
    buffer.push({ method, args });
    if (buffer.length > 400) {
      buffer.splice(0, buffer.length - 400);
    }
  }

  appendChat(content: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'append', [content]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.append(content);
    }
  }

  appendStyledChat(content: StyledText | string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'appendStyled', [content]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.appendStyled(content);
    }
  }

  appendUserChat(content: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'appendUserMessage', [content]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.appendUserMessage(content);
    }
  }

  appendAssistantChat(content: StyledText | string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'appendAssistantMessage', [content]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.appendAssistantMessage(content);
    }
  }

  appendAssistantMarkdown(text: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'appendAssistantMarkdown', [text]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.appendAssistantMarkdown(text);
    }
  }

  upsertAssistantMarkdownBlock(key: string, text: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'upsertAssistantMarkdownBlock', [key, text]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.upsertAssistantMarkdownBlock(key, text);
    }
  }

  removeAssistantMarkdownBlock(key: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'removeAssistantMarkdownBlock', [key]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.removeAssistantMarkdownBlock(key);
    }
  }

  startResponse(tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'startResponse', []);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.startResponse();
    }
  }

  appendResponse(chunk: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'appendResponse', [chunk]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.appendResponse(chunk);
    }
  }

  appendCodeBlock(content: string, filetype?: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'addCodeBlock', [content, filetype]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.addCodeBlock(content, filetype);
    }
  }

  appendDiffBlock(diff: string, filetype?: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.bufferAction(targetTab, 'addDiffBlock', [diff, filetype]);
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.addDiffBlock(diff, filetype);
    }
  }

  addDiffEntry(filePath: string, beforeContent: string, afterContent: string, tabId?: string): void {
    const diff = buildUnifiedDiff({ filePath, beforeContent, afterContent });
    if (!diff) return;
    this.appendDiffBlock(diff, 'diff', tabId);
  }

  appendThinking(chunk: string, tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.commPanel.logThinking(chunk);
    }
  }

  clearThinking(): void {
    this.thinkingPanel.clear();
  }

  setThinkingVisible(visible: boolean): void {
    // No-op: comm panel visibility is user-controlled via Ctrl+T
  }

  updateSidebar(data: SidebarData): void {
    this.headerPanel.updateStatus(data);
  }

  focusInput(): void {
    this.inputPanel.focus();
  }

  setInputPlaceholder(text: string): void {
    this.inputPanel.setPlaceholder(text);
  }

  pushInputHistory(entry: string): void {
    this.inputPanel.pushHistoryEntry(entry);
  }

  showSpinner(label: string = 'Thinking...'): void {
    this.thinkingPanel.startThinking(label);
  }

  hideSpinner(): void {
    this.thinkingPanel.stopThinking();
  }

  setInputHistory(history: string[]): void {
    this.inputPanel.setHistory(history);
  }

  // --- Communication log methods ---

  logPrompt(text: string): void {
    this.commPanel.logPrompt(text);
  }

  logResponse(chunk: string): void {
    this.commPanel.logResponse(chunk);
  }

  endResponse(): void {
    this.commPanel.endResponse();
  }

  logAction(action: string): void {
    this.commPanel.logAction(action);
  }

  logConnectorIn(source: string, message: string): void {
    this.commPanel.logConnectorIn(source, message);
  }

  logConnectorOut(source: string, response: string): void {
    this.commPanel.logConnectorOut(source, response);
  }

  // --- Prompt input (password, text) ---

  async promptInput(
    label: string,
    options?: { masked?: boolean; initialValue?: string },
  ): Promise<string> {
    return this.inputPanel.promptInput(label, options);
  }



  clearChat(tabId?: string): void {
    const targetTab = tabId ?? this.tabsPanel.getActiveTabId();
    this.tabBuffers[targetTab] = [];
    if (targetTab === this.tabsPanel.getActiveTabId()) {
      this.chatPanel.clear();
    }
  }

  showNotification(text: string): void {
    this.notificationPanel.showNotification(text);
  }

  updateNotificationList(items: { id: string; content: string; status: string }[]): void {
    this.notificationPanel.updateNotificationList(items as any);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tabsPanel?.destroy?.();
    display.unbindTUI();
    this.renderer?.destroy();
    // Restore terminal state
    disableBracketedPaste();
  }
}
