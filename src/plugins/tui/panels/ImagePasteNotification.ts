/**
 * ImagePasteNotification - Status bar notification for pasted images
 *
 * Shows above input when an image is pasted via Ctrl+V.
 * Displays filename/size, 3s countdown to auto-add. Esc to dismiss.
 */

import {
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
} from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import { TopBorder } from '../borders';

export class ImagePasteNotification {
  private container: BoxRenderable;
  private infoText: TextRenderable;
  private timerText: TextRenderable;
  private timer: ReturnType<typeof setInterval> | null = null;
  private remainingSeconds = 3;
  private pendingDataUrl: string | null = null;
  private onAddCb: ((dataUrl: string) => void) | null = null;

  constructor(renderer: CliRenderer) {
    this.container = new BoxRenderable(renderer, {
      id: 'image-paste-notification',
      height: 0,
      flexDirection: 'column',
      ...TopBorder,
      borderColor: theme.accent,
      visible: false,
      paddingLeft: 1,
    });

    this.infoText = new TextRenderable(renderer, {
      id: 'image-paste-info',
      height: 1,
    });

    this.timerText = new TextRenderable(renderer, {
      id: 'image-paste-timer',
      height: 1,
    });

    this.container.add(this.infoText);
    this.container.add(this.timerText);
  }

  show(dataUrl: string, filename: string, onAdd: (dataUrl: string) => void): void {
    this.hide();

    this.pendingDataUrl = dataUrl;
    this.onAddCb = onAdd;

    const sizeKB = Math.round((dataUrl.split(',')[1] || '').length * 0.75 / 1024);
    const format = filename.split('.').pop()?.toUpperCase() || 'PNG';

    this.infoText.content = t`${bold(fg(theme.primary)('Image pasted:'))} ${filename} ${dim(`(${sizeKB}KB ${format})`)}`;

    this.remainingSeconds = 3;
    this.updateTimer();

    this.container.visible = true;
    this.container.height = 2;

    this.timer = setInterval(() => {
      this.remainingSeconds--;
      this.updateTimer();
      if (this.remainingSeconds <= 0) {
        this.confirm();
      }
    }, 1000);
  }

  private updateTimer(): void {
    this.timerText.content = t`${fg(theme.warning)(`Adding in ${this.remainingSeconds}s...`)} ${dim('Esc to cancel')}`;
  }

  confirm(): void {
    if (this.pendingDataUrl && this.onAddCb) {
      this.onAddCb(this.pendingDataUrl);
    }
    this.hide();
  }

  hide(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pendingDataUrl = null;
    this.onAddCb = null;
    this.container.visible = false;
    this.container.height = 0;
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  getRenderable(): BoxRenderable {
    return this.container;
  }
}
