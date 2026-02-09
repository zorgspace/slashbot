/**
 * ThinkingPanel - Animated spinner displayed above the input prompt during thinking
 *
 * Shows a single-line animated spinner with label (e.g. "⠋ Reflection...").
 * Hidden by default, auto-shows when thinking starts.
 */

import {
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../theme';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ThinkingPanel {
  private container: BoxRenderable;
  private spinnerLabel: TextRenderable;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;

  constructor(renderer: CliRenderer) {
    this.container = new BoxRenderable(renderer, {
      id: 'thinking-panel',
      height: 0,
      paddingLeft: 1,
      visible: false,
    });

    this.spinnerLabel = new TextRenderable(renderer, {
      id: 'thinking-spinner',
      height: 1,
    });
    this.container.add(this.spinnerLabel);
  }

  startThinking(label: string): void {
    this.clear();
    this.container.visible = true;
    this.container.height = 1;

    this.spinnerFrame = 0;
    this.updateSpinnerFrame(label);
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.updateSpinnerFrame(label);
    }, 150);
  }

  private updateSpinnerFrame(label: string): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame];
    this.spinnerLabel.content = t`${fg(theme.violetLight)(frame + ' ' + label)}`;
  }

  stopThinking(): void {
    this.clear();
  }

  clear(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.container.visible = false;
    this.container.height = 0;
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
