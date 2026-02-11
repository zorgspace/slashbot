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
import { LeftBorder } from '../borders';

const MAX_LINES = 500;
const PRUNE_TO = 400;

export class ChatPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private lineCounter = 0;
  private syntaxStyle: SyntaxStyle | null = null;
  private responseBuffer = '';
  private responseRenderable: TextRenderable | null = null;
  private actionBox: BoxRenderable | null = null;
  private actionTitleRenderable: TextRenderable | null = null;
  private actionSpinnerTimer: ReturnType<typeof setInterval> | null = null;
  private actionSpinnerFrame = 0;
  private actionBaseChunks: any[] = [];
  private actionLineCount = 0;
  private static readonly MAX_ACTION_LINES = 5;
  private assistantBlock: BoxRenderable | null = null;

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
    if (this.actionBox) {
      this.appendActionContent(text);
      return;
    }
    this.addLine(text);
  }

  appendStyled(content: StyledText | string): void {
    if (this.actionBox) {
      this.appendActionContent(content);
      return;
    }
    this.addLine(content);
  }

  appendUserMessage(value: string): void {
    this.closeActionBox();
    this.addBorderedLine(t`${fg(theme.white)(value)}`, theme.primary);
  }

  appendAssistantMessage(content: StyledText | string): void {
    if (this.actionBox) {
      this.appendActionContent(content);
      return;
    }
    const styledContent = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
    this.addBorderedLine(styledContent, theme.accent);
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

  private addBorderedLine(content: StyledText | string, borderColor: string): void {
    this.lineCounter++;
    const text = new TextRenderable(this.renderer, {
      id: `chat-bordered-text-${this.lineCounter}`,
      content,
    });
    const box = new BoxRenderable(this.renderer, {
      id: `chat-bordered-${this.lineCounter}`,
      ...LeftBorder,
      borderColor,
      paddingLeft: 2,
      marginBottom: 1,
    });
    box.add(text);
    this.scrollBox.add(box);
    this.pruneLines();
  }

  /**
   * Start an action block with dark bg, left border
   */
  startAction(content: StyledText | string, _borderColor: string): void {
    this.closeActionBox();
    const styled = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
    this.actionLineCount = 0;
    this.lineCounter++;

    this.actionTitleRenderable = new TextRenderable(this.renderer, {
      id: `chat-action-title-${this.lineCounter}`,
      content: styled,
    });

    this.actionBox = new BoxRenderable(this.renderer, {
      id: `chat-action-${this.lineCounter}`,
      ...LeftBorder,
      borderColor: theme.grey, // grey for pending actions
      paddingLeft: 2,
      flexDirection: 'column',
    });
    this.actionBox.add(this.actionTitleRenderable);
    this.scrollBox.add(this.actionBox);
    this.pruneLines();
  }

  /**
   * Add a content line to the current action block (max 5 lines)
   */
  appendActionContent(content: StyledText | string): void {
    if (!this.actionBox) {
      const styled = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
      this.addBorderedLine(styled, theme.accent);
      return;
    }
    if (this.actionLineCount >= ChatPanel.MAX_ACTION_LINES) {
      return;
    }
    this.actionLineCount++;
    this.lineCounter++;
    const line = new TextRenderable(this.renderer, {
      id: `chat-action-line-${this.lineCounter}`,
      content: typeof content === 'string' ? content : content,
    });
    this.actionBox.add(line);
    if (this.actionLineCount === ChatPanel.MAX_ACTION_LINES) {
      this.lineCounter++;
      const truncLine = new TextRenderable(this.renderer, {
        id: `chat-action-trunc-${this.lineCounter}`,
        content: t`${fg(theme.muted)('...')}`,
      });
      this.actionBox.add(truncLine);
    }
  }

  /**
   * Complete a pending action — update title and border color based on status
   */
  completeAction(content: StyledText | string): void {
    if (this.actionTitleRenderable) {
      this.actionTitleRenderable.content = typeof content === 'string' ? content : content;
      this.actionTitleRenderable = null;
    } else {
      const styled = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
      this.addBorderedLine(styled, theme.accent);
      return;
    }

    // Update border color based on status
    if (this.actionBox) {
      const status = this.getActionStatus(content);
      this.actionBox.borderColor = status === 'error' ? theme.error : theme.accent;
    }

    // actionBox kept alive — closed by closeActionBox() when new section starts
  }

  closeActionBox(): void {
    this.clearActionSpinner();
    this.actionBox = null;
    this.actionTitleRenderable = null;
    this.actionLineCount = 0;
  }

  private clearActionSpinner(): void {
    if (this.actionSpinnerTimer) {
      clearInterval(this.actionSpinnerTimer);
      this.actionSpinnerTimer = null;
    }
    this.actionSpinnerFrame = 0;
  }

  private getActionStatus(content: StyledText | string): 'success' | 'error' | 'unknown' {
    const text = typeof content === 'string' ? content : content.chunks.map(c => c.text).join('');
    if (text.includes('\u2717')) return 'error';
    if (text.includes('\u2713')) return 'success';
    return 'unknown';
  }

  /**
   * Scroll to bottom — call only on action start/finish, not on every line
   */
  scrollToBottom(): void {
    this.scrollBox.scrollTo(Infinity);
  }

  /**
   * Start a bordered block for grouped assistant text (e.g. renderMarkdown)
   */
  startAssistantBlock(): void {
    this.closeActionBox();
    this.lineCounter++;
    this.assistantBlock = new BoxRenderable(this.renderer, {
      id: `chat-assistant-block-${this.lineCounter}`,
      ...LeftBorder,
      borderColor: theme.accent,
      paddingLeft: 2,
      marginTop: 1,
      flexDirection: 'column',
    });
    this.scrollBox.add(this.assistantBlock);
  }

  /**
   * Append a styled line to the current assistant block
   */
  appendAssistantBlockLine(content: StyledText | string): void {
    if (!this.assistantBlock) {
      // Fallback if no block is open
      const styled = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
      this.addBorderedLine(styled, theme.accent);
      return;
    }
    this.lineCounter++;
    const line = new TextRenderable(this.renderer, {
      id: `chat-block-line-${this.lineCounter}`,
      content: typeof content === 'string' ? content : content,
    });
    this.assistantBlock.add(line);
  }

  /**
   * Append a code block inside the current assistant block
   */
  addAssistantBlockCode(content: string, filetype?: string): void {
    if (!this.assistantBlock) {
      this.addCodeBlock(content, filetype);
      return;
    }
    if (this.syntaxStyle && filetype) {
      try {
        const code = new CodeRenderable(this.renderer, {
          id: `chat-block-code-${this.lineCounter++}`,
          content,
          filetype,
          syntaxStyle: this.syntaxStyle,
          fg: theme.white,
        });
        this.assistantBlock.add(code);
      } catch {
        // Fallback: add lines directly
        for (const line of content.split('\n')) {
          this.appendAssistantBlockLine(t`  ${fg(theme.white)(line)}`);
        }
      }
    } else {
      for (const line of content.split('\n')) {
        this.appendAssistantBlockLine(t`  ${fg(theme.white)(line)}`);
      }
    }
  }

  /**
   * End the current assistant block
   */
  endAssistantBlock(): void {
    this.assistantBlock = null;
    this.pruneLines();
  }

  /**
   * Start streaming a response with violet left border
   */
  startResponse(): void {
    this.closeActionBox();
    this.responseBuffer = '';
    this.lineCounter++;
    this.responseRenderable = new TextRenderable(this.renderer, {
      id: `chat-response-text-${this.lineCounter}`,
      content: '',
      selectionBg: theme.accentMuted,
      selectionFg: theme.white,
    });
    const box = new BoxRenderable(this.renderer, {
      id: `chat-response-${this.lineCounter}`,
      ...LeftBorder,
      borderColor: theme.accent,
      paddingLeft: 2,
      marginTop: 1,
    });
    box.add(this.responseRenderable);
    this.scrollBox.add(box);
    this.pruneLines();
  }

  /**
   * Append a chunk to the streaming response
   */
  appendResponse(chunk: string): void {
    if (this.responseRenderable) {
      this.responseBuffer += chunk;
      this.responseRenderable.content = this.responseBuffer;
    }
  }

  /**
   * End the streaming response
   */
  endResponse(): void {
    this.responseRenderable = null;
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
