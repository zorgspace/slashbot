import blessed from 'blessed';

export interface TUICallbacks {
  onInput?: (input: string) => void;
  onKey?: (key: string) => void;
  onResize?: () => void;
  onExit?: () => void;
}

export class SlashbotTUI {
  private screen: blessed.Widgets.Screen;
  private mainBox: blessed.Widgets.BoxElement;
  private sideBox: blessed.Widgets.BoxElement;
  private inputBox: blessed.Widgets.TextboxElement;
  private sideVisible = false;
  private rawOutput = '';
  private callbacks: TUICallbacks = {};

  constructor(callbacks: TUICallbacks = {}) {
    this.callbacks = callbacks;
    this.init();
  }

  private init(): void {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Slashbot',
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: null
      }
    });

    // Main content box (left side)
    this.mainBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3', // Leave space for input
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      content: '',
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    // Side panel for raw LLM output (right side, initially hidden)
    this.sideBox = blessed.box({
      parent: this.screen,
      top: 0,
      right: 0,
      width: '50%',
      height: '100%-3',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      content: 'LLM Raw Output\nPress Ctrl+O to toggle',
      hidden: true,
      style: {
        fg: 'cyan',
        bg: 'black',
        border: {
          fg: 'blue'
        }
      },
      border: {
        type: 'line'
      }
    });

    // Input box at bottom
    this.inputBox = blessed.textbox({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'blue',
        focus: {
          bg: 'green'
        }
      },
      border: {
        type: 'line'
      }
    });

    // Handle keys
    this.screen.key(['C-c'], () => {
      this.callbacks.onExit?.();
    });

    this.screen.key(['C-o'], () => {
      this.toggleSidePanel();
    });

    this.inputBox.key(['enter'], () => {
      const input = this.inputBox.getValue();
      if (input.trim()) {
        this.callbacks.onInput?.(input);
        this.inputBox.clearValue();
        this.inputBox.focus();
      }
    });

    this.screen.key(['C-l'], () => {
      this.clearMain();
    });

    // Handle resize
    this.screen.on('resize', () => {
      this.callbacks.onResize?.();
      this.updateLayout();
    });

    this.updateLayout();
  }

  private updateLayout(): void {
    const width = this.screen.width;
    if (this.sideVisible) {
      this.mainBox.width = '50%';
      this.sideBox.width = '50%';
      this.sideBox.show();
    } else {
      this.mainBox.width = '100%';
      this.sideBox.hide();
    }
    this.screen.render();
  }

  private toggleSidePanel(): void {
    this.sideVisible = !this.sideVisible;
    this.updateLayout();
  }

  // Output to main box
  writeMain(text: string): void {
    this.mainBox.insertBottom(text);
    this.mainBox.setScrollPerc(100);
    this.screen.render();
  }

  // Output to side box (raw LLM)
  writeSide(text: string): void {
    this.rawOutput += text;
    this.sideBox.setContent('LLM Raw Output\n' + this.rawOutput);
    this.sideBox.setScrollPerc(100);
    this.screen.render();
  }

  clearMain(): void {
    this.mainBox.setContent('');
    this.screen.render();
  }

  clearSide(): void {
    this.rawOutput = '';
    this.sideBox.setContent('LLM Raw Output\nPress Ctrl+O to toggle');
    this.screen.render();
  }

  setPrompt(prompt: string): void {
    // For now, just show in input label
    this.inputBox.setLabel(prompt);
  }

  focusInput(): void {
    this.inputBox.focus();
  }

  render(): void {
    this.screen.render();
  }

  destroy(): void {
    this.screen.destroy();
  }
}