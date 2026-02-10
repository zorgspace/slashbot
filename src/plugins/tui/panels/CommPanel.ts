/**
 * CommPanel - Communication log showing prompts sent and responses received
 *
 * Toggle with Ctrl+T. Shows API traffic:
 * -> prompt text sent to LLM
 * <- complete response received from LLM (buffered, shown on completion)
 * <- [Telegram] incoming/outgoing messages
 */

import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import { SplitBorder } from '../borders';

export class CommPanel {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private renderer: CliRenderer;
  private _visible = false;
  private lineCounter = 0;

  // Response buffering: accumulate chunks until endResponse() is called
  private responseBuffer = '';

  // Thinking buffering: accumulate chunks until endResponse() is called
  private thinkingBuffer = '';

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.container = new BoxRenderable(renderer, {
      id: 'comm-container',
      height: 0,
      flexDirection: 'column',
      ...SplitBorder,
      borderColor: theme.borderSubtle,
      visible: false,
    });

    const titleBar = new BoxRenderable(renderer, {
      id: 'comm-titlebar',
      height: 1,
      paddingLeft: 1,
      flexDirection: 'row',
    });

    const title = new TextRenderable(renderer, {
      id: 'comm-title',
      content: t`${bold(fg(theme.accent)('Communication Log'))} ${dim(fg(theme.muted)('Ctrl+T to hide'))}`,
      height: 1,
    });

    titleBar.add(title);

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'comm-scroll',
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
      stickyScroll: true,
      stickyStart: 'bottom',
    });

    this.container.add(titleBar);
    this.container.add(this.scrollBox);
  }

  show(): void {
    this._visible = true;
    this.container.visible = true;
    this.container.height = 14;
  }

  hide(): void {
    this._visible = false;
    this.container.visible = false;
    this.container.height = 0;
  }

  toggle(): void {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this._visible;
  }

  /**
   * Log an outgoing prompt (CLI or connector)
   */
  logPrompt(text: string): void {
    this.addEntry(t`${bold(fg(theme.success)('\u2192'))} ${fg(theme.white)(text)}`);
  }

  /**
   * Buffer a response chunk (call endResponse() to flush)
   */
  logResponse(chunk: string): void {
    this.responseBuffer += chunk;
  }

  /**
   * Flush the buffered thinking first, then the response as a single complete entry
   */
  endResponse(): void {
    if (this.thinkingBuffer) {
      const fullThinking = this.thinkingBuffer.trim();
      if (fullThinking) {
        this.addEntry(t`${dim(fg(theme.accentMuted)('\u{1F4AD} ' + fullThinking))}`);
      }
      this.thinkingBuffer = '';
    }

    if (this.responseBuffer) {
      this.addEntry(t`${fg(theme.muted)('\u2190')} ${dim(fg(theme.white)(this.responseBuffer.trim()))}`);
      this.responseBuffer = '';
    }
  }

  /**
   * Buffer thinking/reasoning content (flushed in endResponse)
   */
  logThinking(chunk: string): void {
    this.thinkingBuffer += chunk;
  }

  /**
   * Log action execution
   */
  logAction(action: string): void {
    this.addEntry(t`${fg(theme.primary)('\u25CF')} ${fg(theme.white)(action)}`);
  }

  /**
   * Log a connector message (incoming from Telegram/Discord)
   */
  logConnectorIn(source: string, message: string): void {
    const label = source.charAt(0).toUpperCase() + source.slice(1);
    this.addEntry(
      t`${bold(fg(theme.secondary)('\u2192'))} ${dim(fg(theme.muted)('[' + label + ']'))} ${fg(theme.white)(message)}`,
    );
  }

  /**
   * Log a connector response (outgoing to Telegram/Discord)
   */
  logConnectorOut(source: string, response: string): void {
    const label = source.charAt(0).toUpperCase() + source.slice(1);
    this.addEntry(
      t`${fg(theme.muted)('\u2190')} ${dim(fg(theme.muted)('[' + label + ']'))} ${dim(fg(theme.white)(response))}`,
    );
  }

  clear(): void {
    // Snapshot IDs first — removing during iteration mutates the array
    const ids = this.scrollBox.getChildren().map(c => c.id);
    for (const id of ids) {
      this.scrollBox.remove(id);
    }
    this.lineCounter = 0;
  }

  private addEntry(content: any): void {
    this.lineCounter++;
    const line = new TextRenderable(this.renderer, {
      id: `comm-line-${this.lineCounter}`,
      content,
      selectionBg: theme.accentMuted,
      selectionFg: theme.white,
    });
    this.scrollBox.add(line);

    // Keep max 200 entries
    const children = this.scrollBox.getChildren();
    if (children.length > 200) {
      this.scrollBox.remove(children[0].id);
    }
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
