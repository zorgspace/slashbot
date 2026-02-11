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
  bold,
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
    this.addBorderedLine(t`${fg(theme.white)(value)}`, theme.primary);
  }

  appendAssistantMessage(content: StyledText | string): void {
    const styledContent = typeof content === 'string' ? t`${fg(theme.white)(content)}` : content;
    this.addBorderedLine(styledContent, theme.accent);
  }

  addCodeBlock(content: string, filetype?: string): void {
    if (this.syntaxStyle && filetype) {
      try {
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
   * Scroll to bottom
   */
  scrollToBottom(): void {
    this.scrollBox.scrollTo(Infinity);
  }

  /**
   * Render markdown text inside a single bordered block.
   * Self-contained: creates the box, parses markdown, adds code blocks inline.
   */
  appendAssistantMarkdown(text: string): void {
    this.lineCounter++;
    const block = new BoxRenderable(this.renderer, {
      id: `chat-assistant-md-${this.lineCounter}`,
      ...LeftBorder,
      borderColor: theme.accent,
      paddingLeft: 2,
      marginTop: 1,
      flexDirection: 'column',
    });

    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];

    const addTextLine = (content: StyledText | string) => {
      this.lineCounter++;
      const line = new TextRenderable(this.renderer, {
        id: `chat-md-line-${this.lineCounter}`,
        content: typeof content === 'string' ? content : content,
      });
      block.add(line);
    };

    const addCode = (content: string, filetype?: string) => {
      if (this.syntaxStyle && filetype) {
        try {
          const code = new CodeRenderable(this.renderer, {
            id: `chat-md-code-${this.lineCounter++}`,
            content,
            filetype,
            syntaxStyle: this.syntaxStyle,
            fg: theme.white,
          });
          block.add(code);
          return;
        } catch {
          // fallback below
        }
      }
      for (const codeLine of content.split('\n')) {
        addTextLine(t`  ${fg(theme.white)(codeLine)}`);
      }
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.slice(3).trim();
          codeBlockLines = [];
        } else {
          addCode(codeBlockLines.join('\n'), codeBlockLang || undefined);
          inCodeBlock = false;
          codeBlockLang = '';
          codeBlockLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      if (line.startsWith('### ')) {
        addTextLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('## ')) {
        addTextLine(t`${bold(fg(theme.primary)(line))}`);
      } else if (line.startsWith('# ')) {
        addTextLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('> ')) {
        addTextLine(t`${fg(theme.muted)('\u2502 ' + line.slice(2))}`);
      } else if (/^[-*] /.test(line)) {
        addTextLine(t`${fg(theme.primary)('\u2022')} ${line.slice(2)}`);
      } else {
        addTextLine(t`${fg(theme.white)(line)}`);
      }
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockLines.length > 0) {
      addCode(codeBlockLines.join('\n'), codeBlockLang || undefined);
    }

    this.scrollBox.add(block);
    this.pruneLines();
  }

  /**
   * Start streaming a response with violet left border
   */
  startResponse(): void {
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
