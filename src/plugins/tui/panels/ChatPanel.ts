/**
 * ChatPanel - Scrollable chat/response area with per-line TextRenderables
 *
 * Uses shared chat row primitives so user/assistant messages keep
 * consistent alignment across plain text, markdown, streaming, code, and diff blocks.
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

const MAX_LINES = 500;
const PRUNE_TO = 400;
const CHAT_MARKER = '\u2022 ';
const CHAT_CONTINUATION_MARKER = '  ';

type ChatRole = 'user' | 'assistant';
type ChatRowContent = TextRenderable | CodeRenderable | DiffRenderable;

export class ChatPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private lineCounter = 0;
  private syntaxStyle: SyntaxStyle | null = null;
  private responseBuffer = '';
  private responseRenderable: TextRenderable | null = null;
  private liveAssistantBlocks = new Map<string, string>();

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
    this.appendChatMessage('user', value);
  }

  appendAssistantMessage(content: StyledText | string): void {
    this.appendChatMessage('assistant', content);
  }

  private contentLineCount(content: string): number {
    return Math.max(1, content.split('\n').length);
  }

  private normalizeMarkdownText(text: string): string {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  addCodeBlock(content: string, filetype?: string): void {
    const block = this.createChatMessageContainer('assistant', 'code');
    let rendered = false;
    if (this.syntaxStyle && filetype) {
      try {
        const lineCount = this.contentLineCount(content);
        const code = new CodeRenderable(this.renderer, {
          id: `chat-code-${this.lineCounter++}`,
          content,
          filetype,
          syntaxStyle: this.syntaxStyle,
          height: lineCount,
          fg: theme.white,
        });
        this.addChatRow(block, 'assistant', code, true);
        rendered = true;
      } catch {
        // fallback below
      }
    }
    if (!rendered) {
      this.addCodeFallback(block, content);
    }
    this.mountChatMessage(block);
  }

  addDiffBlock(diffContent: string, _filetype?: string): void {
    const block = this.createChatMessageContainer('assistant', 'diff');
    let rendered = false;
    if (this.syntaxStyle) {
      try {
        const lineCount = this.contentLineCount(diffContent);
        const diff = new DiffRenderable(this.renderer, {
          id: `chat-diff-${this.lineCounter++}`,
          diff: diffContent,
          syntaxStyle: this.syntaxStyle,
          showLineNumbers: true,
          height: lineCount + 2,
          fg: theme.white,
          addedBg: theme.diffAddedBg,
          removedBg: theme.diffRemovedBg,
          addedSignColor: theme.diffAddedFg,
          removedSignColor: theme.diffRemovedFg,
          lineNumberFg: theme.muted,
          contextBg: 'transparent',
          wrapMode: 'word',
        });

        this.addChatRow(block, 'assistant', diff, true);
        rendered = true;
      } catch {
        // fallback below
      }
    }
    if (!rendered) {
      this.addDiffFallback(block, diffContent);
    }
    this.mountChatMessage(block);
  }

  private addCodeFallback(block: BoxRenderable, content: string): void {
    let firstLine = true;
    this.addChatTextLine(block, 'assistant', t`${fg(theme.muted)('```')}`, firstLine);
    firstLine = false;
    for (const line of content.split('\n')) {
      this.addChatTextLine(block, 'assistant', t`  ${fg(theme.white)(line)}`, firstLine);
      firstLine = false;
    }
    this.addChatTextLine(block, 'assistant', t`${fg(theme.muted)('```')}`, firstLine);
  }

  private addDiffFallback(block: BoxRenderable, diffContent: string): void {
    let firstLine = true;
    for (const line of diffContent.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        this.addChatTextLine(block, 'assistant', t`${fg(theme.diffAddedFg)(line)}`, firstLine);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        this.addChatTextLine(block, 'assistant', t`${fg(theme.diffRemovedFg)(line)}`, firstLine);
      } else if (line.startsWith('@@')) {
        this.addChatTextLine(block, 'assistant', t`${fg(theme.accent)(line)}`, firstLine);
      } else {
        this.addChatTextLine(block, 'assistant', t`${fg(theme.muted)(line)}`, firstLine);
      }
      firstLine = false;
    }
    if (firstLine) {
      this.addChatTextLine(block, 'assistant', '', true);
    }
  }

  clear(): void {
    // Snapshot IDs first — removing during iteration mutates the array and crashes Bun/native
    const ids = this.scrollBox.getChildren().map(c => c.id);
    for (const id of ids) {
      this.scrollBox.remove(id);
    }
    this.lineCounter = 0;
    this.responseBuffer = '';
    this.responseRenderable = null;
    this.liveAssistantBlocks.clear();
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

  private appendChatMessage(role: ChatRole, content: StyledText | string): void {
    const block = this.createChatMessageContainer(role, 'msg');
    if (typeof content === 'string') {
      const lines = content.split('\n');
      if (lines.length === 0) {
        this.addChatTextLine(block, role, '', true);
      } else {
        lines.forEach((line, index) => {
          this.addChatTextLine(block, role, line, index === 0);
        });
      }
    } else {
      this.addChatTextLine(block, role, content, true);
    }
    this.mountChatMessage(block);
  }

  private createChatMessageContainer(role: ChatRole, kind: string): BoxRenderable {
    this.lineCounter++;
    return new BoxRenderable(this.renderer, {
      id: `chat-${role}-${kind}-${this.lineCounter}`,
      paddingLeft: 1,
      marginTop: 1,
      flexDirection: 'column',
    });
  }

  private addChatTextLine(
    block: BoxRenderable,
    role: ChatRole,
    content: StyledText | string,
    isFirstLine: boolean,
  ): void {
    this.lineCounter++;
    const text = new TextRenderable(this.renderer, {
      id: `chat-${role}-text-${this.lineCounter}`,
      content: typeof content === 'string' ? t`${fg(theme.white)(content)}` : content,
    });
    this.addChatRow(block, role, text, isFirstLine);
  }

  private addChatRow(
    block: BoxRenderable,
    role: ChatRole,
    content: ChatRowContent,
    isFirstLine: boolean,
  ): void {
    this.lineCounter++;
    const row = new BoxRenderable(this.renderer, {
      id: `chat-${role}-row-${this.lineCounter}`,
      flexDirection: 'row',
    });
    row.add(this.createChatMarker(role, isFirstLine));
    row.add(content);
    block.add(row);
  }

  private createChatMarker(role: ChatRole, isFirstLine: boolean): TextRenderable {
    this.lineCounter++;
    return new TextRenderable(this.renderer, {
      id: `chat-${role}-marker-${this.lineCounter}`,
      content: isFirstLine
        ? t`${fg(this.getMarkerColor(role))(CHAT_MARKER)}`
        : CHAT_CONTINUATION_MARKER,
    });
  }

  private getMarkerColor(role: ChatRole): string {
    return role === 'user' ? theme.primary : theme.accent;
  }

  private mountChatMessage(block: BoxRenderable): void {
    this.scrollBox.add(block);
    this.pruneLines();
  }

  /**
   * Scroll to bottom
   */
  scrollToBottom(): void {
    this.scrollBox.scrollTo(Infinity);
  }

  private buildAssistantMarkdownBlock(text: string): BoxRenderable {
    const block = this.createChatMessageContainer('assistant', 'md');

    const normalized = this.normalizeMarkdownText(text);
    const lines = normalized.length > 0 ? normalized.split('\n') : [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];
    let hasRows = false;

    const addTextLine = (content: StyledText | string) => {
      this.addChatTextLine(block, 'assistant', content, !hasRows);
      hasRows = true;
    };

    const addRenderableRow = (content: CodeRenderable | DiffRenderable) => {
      this.addChatRow(block, 'assistant', content, !hasRows);
      hasRows = true;
    };

    const addCode = (content: string, filetype?: string) => {
      if (this.syntaxStyle && filetype) {
        try {
          const lineCount = this.contentLineCount(content);
          const code = new CodeRenderable(this.renderer, {
            id: `chat-md-code-${this.lineCounter++}`,
            content,
            filetype,
            syntaxStyle: this.syntaxStyle,
            height: lineCount,
            fg: theme.white,
          });
          addRenderableRow(code);
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

      if (/^\s*(?:error\b|[A-Za-z][A-Za-z ]*error:)/i.test(line)) {
        addTextLine(t`${fg(theme.error)(line)}`);
      } else if (line.startsWith('### ')) {
        addTextLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('## ')) {
        addTextLine(t`${bold(fg(theme.primary)(line))}`);
      } else if (line.startsWith('# ')) {
        addTextLine(t`${bold(fg(theme.accent)(line))}`);
      } else if (line.startsWith('> ')) {
        addTextLine(t`${fg(theme.muted)('\u2022 ' + line.slice(2))}`);
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
    if (!hasRows) {
      addTextLine('');
    }

    this.mountChatMessage(block);
    return block;
  }

  /**
   * Render markdown text inside a single dotted block.
   * Self-contained: creates the block, parses markdown, adds code blocks inline.
   */
  appendAssistantMarkdown(text: string): void {
    this.buildAssistantMarkdownBlock(text);
  }

  upsertAssistantMarkdownBlock(key: string, text: string): void {
    const existingBlockId = this.liveAssistantBlocks.get(key);
    if (existingBlockId) {
      try {
        this.scrollBox.remove(existingBlockId);
      } catch {
        // Block may have been pruned.
      }
    }
    const block = this.buildAssistantMarkdownBlock(text);
    this.liveAssistantBlocks.set(key, block.id);
  }

  removeAssistantMarkdownBlock(key: string): void {
    const existingBlockId = this.liveAssistantBlocks.get(key);
    if (!existingBlockId) return;
    try {
      this.scrollBox.remove(existingBlockId);
    } catch {
      // Block may already be gone.
    }
    this.liveAssistantBlocks.delete(key);
  }

  /**
   * Start streaming a response with a leading dot marker
   */
  startResponse(): void {
    this.responseBuffer = '';
    const block = this.createChatMessageContainer('assistant', 'response');
    this.lineCounter++;
    this.responseRenderable = new TextRenderable(this.renderer, {
      id: `chat-response-text-${this.lineCounter}`,
      content: t`${fg(theme.white)('')}`,
      selectionBg: theme.accentMuted,
      selectionFg: theme.white,
    });
    this.addChatRow(block, 'assistant', this.responseRenderable, true);
    this.mountChatMessage(block);
  }

  /**
   * Append a chunk to the streaming response
   */
  appendResponse(chunk: string): void {
    if (this.responseRenderable) {
      this.responseBuffer += chunk;
      this.responseRenderable.content = t`${fg(theme.white)(this.responseBuffer)}`;
    }
  }

  /**
   * End the streaming response
   */
  endResponse(): void {
    this.responseRenderable = null;
    this.responseBuffer = '';
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
