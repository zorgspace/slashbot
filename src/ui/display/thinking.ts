/**
 * Thinking Display Manager
 *
 * Streams and displays thinking/reasoning content from the LLM in real-time.
 * Visible by default, toggle with Ctrl+O to hide.
 */

import { colors, c } from '../core';

class ThinkingDisplayManager {
  private content: string = '';
  private visible: boolean = true;  // Show thinking by default
  private streaming: boolean = false;
  private streamedLength: number = 0;
  private headerShown: boolean = false;
  private boxClosed: boolean = false;

  /**
   * Start a new thinking stream (called when thinking begins)
   */
  startStream(): void {
    this.content = '';
    this.streamedLength = 0;
    this.streaming = true;
    this.headerShown = false;
    this.boxClosed = false;
    // Don't reset visible - preserve user's preference
  }

  /**
   * Stream a chunk of thinking content in real-time
   */
  streamChunk(chunk: string): void {
    this.content += chunk;

    // Only display if visible, streaming, and box hasn't been closed
    if (this.visible && this.streaming && !this.boxClosed) {
      // Show header on first chunk if visible
      if (!this.headerShown) {
        process.stdout.write(`\n${colors.violetLight}┌─ THINKING ${colors.muted}(Ctrl+O to hide)${colors.reset}\n`);
        process.stdout.write(`${colors.violetLight}│${colors.reset} `);
        this.headerShown = true;
      }

      // Stream the new content, handling newlines
      const newContent = chunk.replace(/\n/g, `\n${colors.violetLight}│${colors.reset} `);
      process.stdout.write(`${colors.muted}${newContent}${colors.reset}`);
      this.streamedLength = this.content.length;
    }
  }

  /**
   * End the thinking stream
   */
  endStream(): void {
    if (this.visible && this.headerShown && !this.boxClosed) {
      process.stdout.write(`\n${colors.violetLight}└─${colors.reset}`);
    }
    this.streaming = false;
    this.headerShown = false;
    this.boxClosed = true;
  }

  /**
   * Check if there's thinking content available
   */
  hasContent(): boolean {
    return this.content.length > 0;
  }

  /**
   * Get the current thinking content
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Check if thinking is currently visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Check if currently streaming
   */
  isStreaming(): boolean {
    return this.streaming;
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    this.visible = !this.visible;

    if (this.visible) {
      if (this.streaming) {
        // Show header and buffered content so far
        process.stdout.write(`\n${colors.violetLight}┌─ THINKING ${colors.muted}(Ctrl+O to hide)${colors.reset}\n`);
        process.stdout.write(`${colors.violetLight}│${colors.reset} `);
        const formatted = this.content.replace(/\n/g, `\n${colors.violetLight}│${colors.reset} `);
        process.stdout.write(`${colors.muted}${formatted}${colors.reset}`);
        this.headerShown = true;
        this.streamedLength = this.content.length;
      } else if (this.hasContent()) {
        // Not streaming, show full content
        this.displayFull();
      } else {
        console.log(c.muted('No thinking content available'));
      }
    } else {
      if (this.streaming && this.headerShown) {
        // Close the box while streaming
        process.stdout.write(`\n${colors.violetLight}└─${colors.muted} (hidden, Ctrl+O to show)${colors.reset}`);
        this.headerShown = false;
      } else if (!this.streaming) {
        console.log(c.muted('Thinking hidden (Ctrl+O to show)'));
      }
    }
  }

  /**
   * Display the full thinking content (when not streaming)
   */
  private displayFull(): void {
    if (!this.content) return;

    const formatted = this.content.replace(/\n/g, `\n${colors.violetLight}│${colors.reset} `);
    console.log(`${colors.violetLight}┌─ THINKING ${colors.muted}(Ctrl+O to hide)${colors.reset}`);
    console.log(`${colors.violetLight}│${colors.reset} ${colors.muted}${formatted}${colors.reset}`);
    console.log(`${colors.violetLight}└─${colors.reset}`);
  }

  /**
   * Show the collapsed indicator after a response (if thinking was hidden)
   */
  showCollapsedIndicator(): void {
    if (this.hasContent() && !this.visible) {
      console.log(c.muted(`[Thinking available - Ctrl+O to show]`));
    }
  }

  /**
   * Clear the thinking content
   */
  clear(): void {
    this.content = '';
    this.streaming = false;
    this.streamedLength = 0;
    this.headerShown = false;
    this.boxClosed = false;
  }
}

// Singleton instance
export const thinkingDisplay = new ThinkingDisplayManager();
