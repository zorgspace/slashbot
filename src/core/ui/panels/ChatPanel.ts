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
  CodeRenderable,
  DiffRenderable,
  SyntaxStyle,
  RGBA,
  t,
  fg,
  type CliRenderer,
  type StyledText,
} from '@opentui/core';
import { theme } from '../theme';

const MAX_LINES = 500;
const PRUNE_TO = 400;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ChatPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private lineCounter = 0;
  private syntaxStyle: SyntaxStyle | null = null;
  private spinnerText: TextRenderable;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    try {
      this.syntaxStyle = SyntaxStyle.fromStyles({
        keyword: { fg: RGBA.fromHex(theme.violet), bold: true },
        string: { fg: RGBA.fromHex(theme.success) },
        comment: { fg: RGBA.fromHex(theme.muted), italic: true },
        number: { fg: RGBA.fromHex(theme.warning) },
        function: { fg: RGBA.fromHex(theme.violetLight) },
        type: { fg: RGBA.fromHex(theme.warning) },
        operator: { fg: RGBA.fromHex(theme.white) },
        punctuation: { fg: RGBA.fromHex(theme.muted) },
      });
    } catch {
      //
    }

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'chat-scroll',
      flexGrow: 1,
      stickyScroll: false,
      stickyStart: 'bottom',
    });

    this.spinnerText = new TextRenderable(renderer, {
      id: 'chat-spinner',
      content: '',
    });
    this.spinnerText.visible = false;
    this.scrollBox.add(this.spinnerText);

    this.container = new BoxRenderable(renderer, {
      id: 'chat-container',
      flexGrow: 1,
      flexShrink: 0,
      flexDirection: 'column',
    });
    this.container.add(this.scrollBox);
  }

  append(text: string): void {
    this.addLine(text);
  }

  appendStyled(content: StyledText | string): void {
    this.addLine(content);
  }

  appendUserMessage(value: string): void {
    this.addLine(t`${fg(theme.violetLight)('You:')} ${fg(theme.white)(value)}`);
  }

  addCodeBlock(content: string, filetype?: string): void {
    if (this.syntaxStyle && filetype) {
      try {
        const lineCount = content.split('\n').length;
        const code = new CodeRenderable(this.renderer, {
          id: `chat-code-${this.lineCounter++}`,
          content,
          filetype,
          syntaxStyle: this.syntaxStyle,
          fg: theme.white,
        });
        this.scrollBox.insertBefore(code, this.spinnerText);
        // scroll managed by display service
        this.pruneLines();
      } catch {
        this.addCodeFallback(content);
      }
    } else {
      this.addCodeFallback(content);
    }
  }

  addDiffBlock(diffContent: string, _filetype?: string): void {
    if (this.syntaxStyle) {
      try {
        const lineCount = diffContent.split('\n').length;
        const diff = new DiffRenderable(this.renderer, {
          id: `chat-diff-${this.lineCounter++}`,
          diff: diffContent,
          syntaxStyle: this.syntaxStyle,
          showLineNumbers: true,
          height: Math.min(lineCount + 2, 15),
          fg: theme.white,
          addedBg: '#0a3d0a',
          removedBg: '#3d0a0a',
          addedSignColor: theme.success,
          removedSignColor: theme.error,
          lineNumberFg: theme.muted,
          lineNumberBg: theme.bgPanel,
          contextBg: theme.bgPanel,
          wrapMode: 'word',
        });

        this.scrollBox.insertBefore(diff, this.spinnerText);
        // scroll managed by display service
        this.pruneLines();
      } catch {
        this.addDiffFallback(diffContent);
      }
    } else {
      this.addDiffFallback(diffContent);
    }
  }

  private addCodeFallback(content: string): void {
    this.addLine(t`${fg(theme.muted)('```')}`);
    for (const line of content.split('\n')) {
      this.addLine(t`  ${fg(theme.white)(line)}`);
    }
    this.addLine(t`${fg(theme.muted)('```')}`);
  }

  private addDiffFallback(diffContent: string): void {
    for (const line of diffContent.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        this.addLine(t`  ${fg(theme.success)(line)}`);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        this.addLine(t`  ${fg(theme.error)(line)}`);
      } else if (line.startsWith('@@')) {
        this.addLine(t`  ${fg(theme.violet)(line)}`);
      } else {
        this.addLine(t`  ${fg(theme.muted)(line)}`);
      }
    }
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

  showSpinner(label: string = 'Thinking...'): void {
    if (this.spinnerInterval) return;

    this.spinnerFrame = 0;
    this.spinnerText.visible = true;
    this.updateSpinnerFrame(label);

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.updateSpinnerFrame(label);
    }, 150);
  }

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
    const id = `chat-line-${this.lineCounter}`;
    const line = new TextRenderable(this.renderer, {
      id,
      content: typeof content === 'string' ? content : content,
    });
    this.scrollBox.insertBefore(line, this.spinnerText);
    this.pruneLines();
  }

  /**
   * Scroll to bottom — call only on action start/finish, not on every line
   */
  scrollToBottom(): void {
    this.scrollBox.scrollTo(Infinity);
  }

  private pruneLines(): void {
    const children = this.scrollBox.getChildren();
    const lineChildren = children.filter((c: { id: string }) => c.id !== 'chat-spinner');
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
