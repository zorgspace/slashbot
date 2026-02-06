/**
 * TUIApp - Main OpenTUI dashboard orchestrator
 *
 * Manages the full-screen layout with header (incl. status),
 * chat, communication log panel, and input area.
 */

import { createCliRenderer,  BoxRenderable, type CliRenderer, type StyledText } from '@opentui/core';
import { theme } from './theme';
import { display } from './display';
import type { UIOutput, SidebarData, TUIAppCallbacks } from './types';
import type { HeaderOptions } from './panels/HeaderPanel';
import { HeaderPanel } from './panels/HeaderPanel';
import { ChatPanel } from './panels/ChatPanel';
import { CommPanel } from './panels/CommPanel';
import { CommandPalettePanel } from './panels/CommandPalettePanel';
import { InputPanel } from './panels/InputPanel';
import { OutputInterceptor } from './adapters/OutputInterceptor';
import { enableBracketedPaste, disableBracketedPaste } from './pasteHandler';

export class TUIApp implements UIOutput {
  private renderer!: CliRenderer;
  private headerPanel!: HeaderPanel;
  private chatPanel!: ChatPanel;
  private commPanel!: CommPanel;
  private commandPalette!: CommandPalettePanel;
  private inputPanel!: InputPanel;
  private interceptor!: OutputInterceptor;
  private callbacks: TUIAppCallbacks;
  private completer?: (line: string) => [string[], string];
  private history: string[];
  private destroyed = false;
  private lastCtrlC = 0;
  private lastSelectedText = '';

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

    // Create renderer with Ctrl+C and signal handling disabled
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
    });
    this.renderer.setBackgroundColor(theme.bg);

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

    // Content column: chat + comm panel
    const contentColumn = new BoxRenderable(this.renderer, {
      id: 'content-column',
      flexDirection: 'column',
      flexGrow: 1,
      justifyContent: 'flex-end',
    });

    // Chat panel
    this.chatPanel = new ChatPanel(this.renderer);
    contentColumn.add(this.chatPanel.getRenderable());

    // Communication log panel (hidden by default, Ctrl+T to toggle)
    this.commPanel = new CommPanel(this.renderer);
    contentColumn.add(this.commPanel.getRenderable());

    root.add(contentColumn);

    // Command palette (hidden by default, shown on Tab with '/')
    this.commandPalette = new CommandPalettePanel(this.renderer);
    root.add(this.commandPalette.getRenderable());

    // Input panel
    this.inputPanel = new InputPanel(this.renderer, {
      onSubmit: async value => {
        this.chatPanel.addSeparator();
        this.chatPanel.appendUserMessage(value);
        await this.callbacks.onInput(value);
      },
      completer: this.completer,
      history: this.history,
    });
    root.add(this.inputPanel.getRenderable());

    this.renderer.root.add(root);

    // Auto-copy text to clipboard + primary selection when selection finishes
    this.renderer.on('selection', () => {
      const sel = this.renderer.getSelection();
      if (sel) {
        const text = sel.getSelectedText();
        if (text) {
          this.lastSelectedText = text;
          this.renderer.copyToClipboardOSC52(text);
          this.renderer.copyToClipboardOSC52(text, 1); // Primary selection
        }
      }
    });

    // Click anywhere: middle-click pastes last selection, any click focuses input
    root.onMouseDown = (event) => {
      if (event.button === 1 && this.lastSelectedText) {
        this.inputPanel.insertText(this.lastSelectedText);
      }
      this.inputPanel.focus();
    };

    // Auto-focus input on startup
    this.inputPanel.focus();

    // Set up output interceptor to route console output to chat
    this.interceptor = new OutputInterceptor({
      append: (text: string) => this.chatPanel.append(text),
    });
    this.interceptor.start();

    // Set up keyboard handlers via keyInput EventEmitter
    const keyHandler = this.renderer.keyInput;

    keyHandler.on('keypress', key => {
      // Ctrl+C - clear input (if focused) or abort; double Ctrl+C exits
      if (key.ctrl && key.name === 'c') {
        key.stopPropagation();
        key.preventDefault();
        const now = Date.now();
        if (now - this.lastCtrlC < 2000) {
          this.callbacks.onExit();
          return;
        }
        this.lastCtrlC = now;
        if (this.inputPanel.isFocused()) {
          this.inputPanel.clear();
        } else {
          this.callbacks.onAbort();
          this.chatPanel.append('Press Ctrl+C again to exit');
        }
        return;
      }

      // Ctrl+L - clear chat
      if (key.ctrl && key.name === 'l') {
        key.stopPropagation();
        key.preventDefault();
        this.chatPanel.clear();
        return;
      }

      // Ctrl+T - toggle communication log
      if (key.ctrl && key.name === 't') {
        key.stopPropagation();
        key.preventDefault();
        this.commPanel.toggle();
        return;
      }

      // The following keys only apply when input is focused
      if (this.inputPanel.isFocused()) {
        // Enter - submit input
        if (key.name === 'return') {
          key.stopPropagation();
          key.preventDefault();
          const value = this.inputPanel.getValue();
          if (value.trim()) {
            this.chatPanel.addSeparator();
            this.chatPanel.appendUserMessage(value);
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

        // Hide palette on Escape
        if (key.name === 'escape') {
          if (this.commandPalette.isVisible()) {
            key.stopPropagation();
            key.preventDefault();
            this.commandPalette.hide();
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

    // Bind display service so all styled output goes through TUI natively
    display.bindTUI(this);
  }

  // --- UIOutput interface ---

  setHeader(options: HeaderOptions): void {
    this.headerPanel.setOptions(options);
  }

  appendChat(content: string): void {
    this.chatPanel.append(content);
  }

  appendStyledChat(content: StyledText | string): void {
    this.chatPanel.appendStyled(content);
  }

  appendThinking(chunk: string): void {
    this.commPanel.logThinking(chunk);
  }

  clearThinking(): void {
    // No-op: comm panel accumulates, doesn't clear per-request
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

  showSpinner(label: string = 'Thinking...'): void {
    this.chatPanel.showSpinner(label);
  }

  hideSpinner(): void {
    this.chatPanel.hideSpinner();
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

  async promptInput(label: string, options?: { masked?: boolean }): Promise<string> {
    return this.inputPanel.promptInput(label, options);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    display.unbindTUI();
    this.interceptor?.stop();
    this.renderer?.destroy();
    // Restore terminal state
    disableBracketedPaste();
  }
}
