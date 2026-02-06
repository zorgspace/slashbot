/**
 * ChatPanel - Scrollable chat/response area with per-line TextRenderables
 *
 * Uses ScrollBoxRenderable with individual TextRenderable per line,
 * supporting both plain strings and OpenTUI StyledText content.
 */

import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  t,
  fg,
  type CliRenderer,
  type StyledText,
} from '@opentui/core';
import { theme } from '../theme';

const SPINNER_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];

const MAX_LINES = 500;
const PRUNE_TO = 400;

export class ChatPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private spinnerText: TextRenderable;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private renderer: CliRenderer;
  private lineCounter = 0;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'chat-container',
      flexGrow: 1,
      flexDirection: 'column',
      border: false,
    });

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'chat-scroll',
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
    });

    // Spinner line at the bottom of the scroll box (hidden by default)
    this.spinnerText = new TextRenderable(renderer, {
      id: 'chat-spinner',
      content: '',
      height: 1,
      visible: false,
    });

    this.scrollBox.add(this.spinnerText);
    this.container.add(this.scrollBox);
  }

  /**
   * Append plain text as a new line in the chat
   */
  append(text: string): void {
    this.addLine(text);
  }

  /**
   * Append styled content (StyledText or string) as a new line
   */
  appendStyled(content: StyledText | string): void {
    this.addLine(content);
  }

  /**
   * Display the user's input message in the chat (styled)
   */
  appendUserMessage(text: string): void {
    this.addLine(t`${fg(theme.violet)('❯')} ${text}`);
  }

  /**
   * Add a blank line separator (call between chat turns)
   */
  addSeparator(): void {
    this.addLine('');
  }

  clear(): void {
    const children = this.scrollBox.getChildren();
    for (const child of children) {
      if (child.id !== 'chat-spinner') {
        this.scrollBox.remove(child.id);
      }
    }
    this.lineCounter = 0;
  }

  /**
   * Show a spinning indicator with a label (e.g. "Thinking...")
   */
  showSpinner(label: string = 'Thinking...'): void {
    if (this.spinnerInterval) return; // Already showing

    this.spinnerFrame = 0;
    this.spinnerText.visible = true;
    this.updateSpinnerFrame(label);

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.updateSpinnerFrame(label);
    }, 150);
  }

  /**
   * Hide the spinner
   */
  hideSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.spinnerText.visible = false;
    this.spinnerText.content = '';
  }

  private updateSpinnerFrame(label: string): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame];
    this.spinnerText.content = t`${fg(theme.violetLight)(frame + ' ' + label)}`;
    this.scrollBox.scrollTo(Infinity);
  }

  private addLine(content: StyledText | string): void {
    this.lineCounter++;
    const line = new TextRenderable(this.renderer, {
      id: `chat-line-${this.lineCounter}`,
      content,
      selectionBg: theme.violetDark,
      selectionFg: theme.white,
    });

    // Insert before the spinner (spinner should always be last)
    // Remove spinner, add line, re-add spinner
    this.scrollBox.remove('chat-spinner');
    this.scrollBox.add(line);
    this.scrollBox.add(this.spinnerText);

    // Auto-scroll only if user is at or near the bottom
    const currentScroll = (this.scrollBox as any).getScrollTop?.() ?? 0;
    const maxScroll = (this.scrollBox as any).getMaxScroll?.() ?? 0;
    if (currentScroll >= maxScroll - 2) { // Within 2 lines of bottom
      this.scrollBox.scrollTo(Infinity);
    }

    // Prune old lines
    this.pruneLines();
  }

  private pruneLines(): void {
    const children = this.scrollBox.getChildren();
    // Count non-spinner children
    const lineChildren = children.filter(c => c.id !== 'chat-spinner');
    if (lineChildren.length > MAX_LINES) {
      const toRemove = lineChildren.slice(0, lineChildren.length - PRUNE_TO);
      for (const child of toRemove) {
        this.scrollBox.remove(child.id);
      }
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
