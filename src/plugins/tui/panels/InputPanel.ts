/**
 * InputPanel - Text input with history and tab completion
 *
 * Compact bordered input with prompt label and safe prompt-mode takeover.
 */

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  t,
  fg,
  bold,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../../../core/ui/theme';

export interface InputPanelOptions {
  onSubmit: (value: string) => void;
  completer?: (line: string) => [string[], string];
  history?: string[];
}

export class InputPanel {
  private container: BoxRenderable;
  private input: InputRenderable;
  private promptLabel: TextRenderable;
  private history: string[] = [];
  private historyIndex = -1;
  private currentInput = '';
  private submitCallback: (value: string) => void;
  private completer?: (line: string) => [string[], string];
  private _isPromptActive = false;
  private promptResolver: ((value: string) => void) | null = null;
  private promptCleanup: (() => void) | null = null;
  private readonly defaultPromptContent = t`${bold(fg(theme.primary)('❯ '))}`;
  private readonly defaultPromptWidth = 3;

  constructor(renderer: CliRenderer, options: InputPanelOptions) {
    this.submitCallback = options.onSubmit;
    this.completer = options.completer;
    if (options.history) {
      this.history = [...options.history];
    }

    this.container = new BoxRenderable(renderer, {
      id: 'input-container',
      height: 3,
      width: '100%',
      flexDirection: 'row',
      border: true,
      borderColor: theme.borderSubtle,
      alignItems: 'center',
      paddingLeft: 1,
      paddingRight: 1,
    });

    this.promptLabel = new TextRenderable(renderer, {
      id: 'input-prompt',
      content: this.defaultPromptContent,
      width: this.defaultPromptWidth,
      height: 1,
    });

    this.input = new InputRenderable(renderer, {
      id: 'input-field',
      flexGrow: 1,
      textColor: theme.white,
      placeholder: 'Type your message...',
      placeholderColor: theme.muted,
      onSubmit: () => {
        this.handleSubmit();
      },
    });

    this.container.add(this.promptLabel);
    this.container.add(this.input);
  }

  private handleSubmit(): void {
    // Prompt mode (e.g. New Agent flow) owns Enter handling.
    // If we process submit here, prompt values are cleared before prompt resolver reads them.
    if (this._isPromptActive) {
      return;
    }
    const value = this.input.value;
    if (value.trim()) {
      this.submitCallback(value);
      this.input.value = '';
      this.historyIndex = -1;
      this.currentInput = '';
    }
  }

  focus(): void {
    this.input.focus();
  }

  blur(): void {
    this.input.blur();
  }

  isFocused(): boolean {
    return this.input.focused;
  }

  isPromptActive(): boolean {
    return this._isPromptActive;
  }

  getValue(): string {
    return this.input.value;
  }

  clear(): void {
    this.input.value = '';
  }

  insertText(text: string): void {
    this.input.insertText(text);
  }

  setPlaceholder(text: string): void {
    this.input.placeholder = text;
  }

  getDefaultPlaceholder(): string {
    return 'Type your message...';
  }

  private resetPromptChrome(): void {
    this.promptLabel.content = this.defaultPromptContent;
    this.promptLabel.width = this.defaultPromptWidth;
  }

  cancelPrompt(): void {
    if (!this._isPromptActive) {
      this.resetPromptChrome();
      return;
    }
    const cleanup = this.promptCleanup;
    const resolve = this.promptResolver;
    this.promptCleanup = null;
    this.promptResolver = null;
    cleanup?.();
    resolve?.('');
  }

  setHistory(history: string[]): void {
    this.history = [...history];
  }

  /**
   * Push a single entry to the history (used to sync expanded paste content)
   */
  pushHistoryEntry(entry: string): void {
    this.history.push(entry);
    this.historyIndex = -1;
  }

  /**
   * Navigate history up (older)
   */
  historyUp(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.currentInput = this.input.value;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    }
    this.input.value = this.history[this.historyIndex];
  }

  /**
   * Navigate history down (newer)
   */
  historyDown(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.input.value = this.history[this.historyIndex];
    } else {
      this.historyIndex = -1;
      this.input.value = this.currentInput;
    }
  }

  /**
   * Tab completion.
   * Returns the number of matching completions (0 = no completer, 1 = unique match, >1 = multiple).
   */
  tabComplete(): number {
    if (!this.completer) return 0;
    const value = this.input.value;
    const [completions] = this.completer(value);
    if (completions.length === 1) {
      this.input.value = completions[0] + ' ';
    } else if (completions.length > 1) {
      // Find common prefix among completions
      let common = completions[0];
      for (const c of completions) {
        while (!c.startsWith(common)) {
          common = common.slice(0, -1);
        }
      }
      if (common.length > value.length) {
        this.input.value = common;
      }
    }
    return completions.length;
  }

  /**
   * Temporarily take over the input for a prompt (e.g. password entry).
   * Resolves when the user presses Enter. Restores normal input after.
   */
  promptInput(label: string, options?: { masked?: boolean }): Promise<string> {
    if (this._isPromptActive) {
      this.cancelPrompt();
    }

    return new Promise(resolve => {
      this._isPromptActive = true;
      this.promptResolver = resolve;
      const masked = options?.masked ?? false;
      const savedPlaceholder = this.input.placeholder;
      const savedValue = this.input.value;
      // Start from known defaults to avoid cumulative width drift.
      this.resetPromptChrome();

      if (masked) {
        this.promptLabel.content = '';
        this.promptLabel.width = 1;
      } else {
        const promptText = `${label.trim()}: `;
        this.promptLabel.content = t`${bold(fg(theme.warning)(promptText))}`;
        // Keep prompt width tied to actual label length.
        this.promptLabel.width = Math.max(3, [...promptText].length + 1);
      }

      this.input.value = '';
      this.input.placeholder = masked ? 'Enter password...' : label;
      this.input.focus();

      let realValue = '';
      let inputListener: ((value: string) => void) | null = null;
      let enterListener: (() => void) | null = null;

      const cleanup = () => {
        this._isPromptActive = false;
        this.promptCleanup = null;
        if (inputListener) this.input.off(InputRenderableEvents.INPUT, inputListener);
        if (enterListener) this.input.off(InputRenderableEvents.ENTER, enterListener);
        // Restore normal chrome deterministically.
        this.resetPromptChrome();
        this.input.value = savedValue;
        this.input.placeholder = savedPlaceholder;
        this.input.focus();
      };
      this.promptCleanup = cleanup;

      if (masked) {
        // Track real value while displaying asterisks
        inputListener = () => {
          const displayed = this.input.value;
          // Determine what changed by comparing lengths
          if (displayed.length > realValue.length) {
            // Characters were added — extract the non-asterisk chars
            for (let i = 0; i < displayed.length; i++) {
              if (i >= realValue.length) {
                // New character added at end
                realValue += displayed[i];
              } else if (displayed[i] !== '*') {
                // Character inserted/replaced in the middle
                realValue = realValue.slice(0, i) + displayed[i] + realValue.slice(i);
              }
            }
            // Trim realValue to match length in case of weird state
            realValue = realValue.slice(0, displayed.length);
          } else if (displayed.length < realValue.length) {
            // Characters were deleted
            realValue = realValue.slice(0, displayed.length);
          }
          // Replace display with asterisks
          this.input.value = '*'.repeat(realValue.length);
        };
        this.input.on(InputRenderableEvents.INPUT, inputListener);
      }

      enterListener = () => {
        const value = masked ? realValue : this.input.value;
        this.promptResolver = null;
        cleanup();
        resolve(value);
      };
      this.input.on(InputRenderableEvents.ENTER, enterListener);
    });
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
