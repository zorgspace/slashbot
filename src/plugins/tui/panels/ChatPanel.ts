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
import { theme } from '../../../core/ui/theme';

const MAX_LINES = 500;
const PRUNE_TO = 400;

export class ChatPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private lineCounter = 0;
  private syntaxStyle: SyntaxStyle | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    try {
      this.syntaxStyle = SyntaxStyle.fromStyles({
        keyword: { fg: RGBA.fromHex(theme.accent), bold: true },
        string: { fg: RGBA.fromHex(theme.success) },
        comment: { fg: RGBA.fromHex(theme.muted), italic: true },
        number: { fg: RGBA.fromHex(theme.warning) },
        function: { fg: RGBA.fromHex(theme.secondary) },
        type: { fg: RGBA.fromHex(theme.primary) },
        operator: { fg: RGBA.fromHex(theme.white) },
        punctuation: { fg: RGBA.fromHex(theme.muted) },
      });
    } catch {
      //
    }

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'chat-scroll',
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: 'bottom',
    });

    this.container = new BoxRenderable(renderer, {
      id: 'chat-container',
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: 'column',
      overflow: 'hidden',
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
    // User messages with primary-color left accent
    this.addLine(t`${fg(theme.primary)('┃')} ${fg(theme.white)(value)}`);
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
        this.scrollBox.add(code);
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
          addedBg: theme.diffAddedBg,
          removedBg: theme.diffRemovedBg,
          addedSignColor: theme.diffAddedFg,
          removedSignColor: theme.diffRemovedFg,
          lineNumberFg: theme.muted,
          contextBg: theme.bgPanel,
          wrapMode: 'word',
        });

        this.scrollBox.add(diff);
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
        this.addLine(t`  ${fg(theme.diffAddedFg)(line)}`);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        this.addLine(t`  ${fg(theme.diffRemovedFg)(line)}`);
      } else if (line.startsWith('@@')) {
        this.addLine(t`  ${fg(theme.accent)(line)}`);
      } else {
        this.addLine(t`  ${fg(theme.muted)(line)}`);
      }
    }
  }

  clear(): void {
    // Snapshot IDs first — removing during iteration mutates the array and crashes Bun/native
    const ids = this.scrollBox.getChildren().map(c => c.id);
    for (const id of ids) {
      this.scrollBox.remove(id);
    }
    this.lineCounter = 0;
  }

  private addLine(content: StyledText | string): void {
    this.lineCounter++;
    const id = `chat-line-${this.lineCounter}`;
    const line = new TextRenderable(this.renderer, {
      id,
      content: typeof content === 'string' ? content : content,
    });
    this.scrollBox.add(line);
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
    if (children.length > MAX_LINES) {
      const idsToRemove = children.slice(0, children.length - PRUNE_TO).map(c => c.id);
      for (const id of idsToRemove) {
        this.scrollBox.remove(id);
      }
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
