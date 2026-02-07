/**
 * TUIApp - Main OpenTUI dashboard orchestrator
 *
 * Manages the full-screen layout with header (incl. status),
 * chat, communication log panel, and input area.
 */

import {
  createCliRenderer,
  BoxRenderable,
  ConsolePosition,
  type CliRenderer,
  type StyledText,
} from '@opentui/core';
import { theme } from './theme';
import { display } from './display';
import type { UIOutput, SidebarData, TUIAppCallbacks } from './types';
import type { HeaderOptions } from './panels/HeaderPanel';
import { HeaderPanel } from './panels/HeaderPanel';
import { ChatPanel } from './panels/ChatPanel';
import { CommPanel } from './panels/CommPanel';
import { CommandPalettePanel } from './panels/CommandPalettePanel';
import { InputPanel } from './panels/InputPanel';
import { ModelSelectModal } from './panels/ModelSelectModal';
import {
  enableBracketedPaste,
  disableBracketedPaste,
  readImageFromClipboard,
} from './pasteHandler';
import { addImage, imageBuffer } from '../code/imageBuffer';
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
  private chatPanel!: ChatPanel;
  private commPanel!: CommPanel;
  private commandPalette!: CommandPalettePanel;
  private inputPanel!: InputPanel;
  private modelSelectModal!: ModelSelectModal;
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

    this.modelSelectModal = new ModelSelectModal(this.renderer);
    root.add(this.modelSelectModal.getRenderable());

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
          this.renderer.setBackgroundColor(theme.violetDark);
          setTimeout(() => this.renderer.setBackgroundColor(theme.bg), 120);
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

      // Ctrl+V - paste image from clipboard (when input focused)
      if (key.ctrl && key.name === 'v' && this.inputPanel.isFocused()) {
        key.stopPropagation();
        key.preventDefault();
        readImageFromClipboard()
          .then(dataUrl => {
            if (dataUrl) {
              addImage(dataUrl);
              display.successText(`🖼️  Image added to context #${imageBuffer.length}`);
            } else {
              display.warningText('No image in clipboard. Copy an image first, then Ctrl+V.');
            }
          })
          .catch(() => {
            display.warningText('Could not read image from clipboard.');
          });
        return;
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

        // Handle model select modal keys
        if (this.modelSelectModal.isVisible()) {
          if (this.modelSelectModal.handleKey(key)) {
            key.stopPropagation();
            key.preventDefault();
            return;
          }
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

  appendCodeBlock(content: string, filetype?: string): void {
    this.chatPanel.addCodeBlock(content, filetype);
  }

  appendDiffBlock(diff: string, filetype?: string): void {
    this.chatPanel.addDiffBlock(diff, filetype);
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

  setModelSelectModels(current: string, available: string[] | readonly string[]): void {
    this.modelSelectModal.setModels(current, available);
  }

  showModelSelectModal(onSelect: (model: string) => void, onCancel?: () => void): void {
    this.modelSelectModal.show(
      (model: string) => {
        onSelect(model);
        this.inputPanel.focus();
      },
      () => {
        onCancel?.();
        this.inputPanel.focus();
      },
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    display.unbindTUI();
    this.renderer?.destroy();
    // Restore terminal state
    disableBracketedPaste();
  }
}
