/**
 * Thinking Animation
 */

import { colors } from '../core';

export class ThinkingAnimation {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private text = '';
  private startTime: number = 0;
  private contextPath: string = '';

  start(initialText = 'Thinking...', contextPath?: string): void {
    this.text = initialText;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.contextPath = contextPath || '';
    // Clear line before starting to prevent flicker from existing content
    process.stdout.write(`\r\x1b[K${colors.violetLight}${this.frames[0]} ${this.text}${colors.reset}`);

    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(
        `\r\x1b[K${colors.violetLight}${this.frames[this.frameIndex]} ${this.text}${colors.reset}`,
      );
    }, 150);
  }

  update(text: string): void {
    this.text = text.slice(0, 60);
  }

  stop(): string {
    // Only output if animation was actually running (interval exists)
    const wasRunning = this.interval !== null;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Clear the line
    if (wasRunning) {
      process.stdout.write(`\r\x1b[K`);
    }

    // Return duration for caller to display with response
    return this.formatDuration(Date.now() - this.startTime);
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const m = minutes % 60;
      const s = seconds % 60;
      return `${hours}h ${m}m ${s}s`;
    } else if (minutes > 0) {
      const s = seconds % 60;
      return `${minutes}m ${s}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }
}
