/**
 * ModelSelectModal - Modal for selecting AI models
 *
 * Centered overlay with SelectRenderable for model picking.
 * Hidden by default; shown when user runs /model without args.
 */

import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
  type SelectOption,
} from '@opentui/core';
import { theme } from '../theme';

export class ModelSelectModal {
  private overlay: BoxRenderable;
  private modal: BoxRenderable;
  private select: SelectRenderable;
  private renderer: CliRenderer;
  private _visible = false;
  private currentModel: string;
  private availableModels: string[];
  private onSelect?: (model: string) => void;
  private onCancel?: () => void;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    this.currentModel = 'grok-4-1-fast-reasoning';
    this.availableModels = [];

    // Full-screen overlay (semi-transparent effect via dark bg)
    this.overlay = new BoxRenderable(renderer, {
      id: 'model-overlay',
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000',
      justifyContent: 'center',
      alignItems: 'center',
      visible: false,
      zIndex: 200,
    });

    // Modal box
    this.modal = new BoxRenderable(renderer, {
      id: 'model-modal',
      width: 50,
      height: 12,
      backgroundColor: theme.bgPanel,
      border: true,
      borderColor: theme.violet,
      flexDirection: 'column',
      padding: 1,
    });

    // Title
    const title = new TextRenderable(renderer, {
      id: 'model-title',
      content: t`${bold(fg(theme.violet)('Select AI Model'))}`,
      height: 1,
    });
    this.modal.add(title);

    // Spacer
    const spacer = new TextRenderable(renderer, {
      id: 'model-spacer',
      content: '',
      height: 1,
    });
    this.modal.add(spacer);

    // Select list
    this.select = new SelectRenderable(renderer, {
      id: 'model-select',
      flexGrow: 1,
      width: '100%',
      options: [],
      backgroundColor: theme.bgPanel,
      selectedBackgroundColor: theme.violetDark,
      textColor: theme.white,
      selectedTextColor: theme.white,
      descriptionColor: theme.muted,
      showDescription: true,
      wrapSelection: true,
    });
    this.modal.add(this.select);

    // Instructions
    const instructions = new TextRenderable(renderer, {
      id: 'model-instructions',
      content: t`${dim(fg(theme.muted)('Up/Down navigate  Enter select  Esc cancel'))}`,
      height: 1,
    });
    this.modal.add(instructions);

    this.overlay.add(this.modal);

    // Handle selection
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => {
      this.hide();
      this.onSelect?.(option.value as string);
    });
  }

  setModels(currentModel: string, availableModels: string[] | readonly string[]): void {
    this.currentModel = currentModel;
    this.availableModels = [...availableModels];
    this.updateOptions();
  }

  private updateOptions(): void {
    const options: SelectOption[] = this.availableModels.map(model => ({
      name: model === this.currentModel ? `${model} (current)` : model,
      description: '',
      value: model,
    }));
    this.select.options = options;

    // Pre-select current model
    const currentIndex = this.availableModels.indexOf(this.currentModel);
    if (currentIndex >= 0) {
      this.select.setSelectedIndex(currentIndex);
    }
  }

  show(onSelect?: (model: string) => void, onCancel?: () => void): void {
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.updateOptions();
    this.overlay.visible = true;
    this._visible = true;
    this.select.focus();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay.visible = false;
    this.select.blur();
  }

  isVisible(): boolean {
    return this._visible;
  }

  getRenderable(): BoxRenderable {
    return this.overlay;
  }

  handleKey(key: any): boolean {
    if (!this._visible) return false;

    if (key.name === 'escape') {
      this.hide();
      this.onCancel?.();
      return true;
    }

    // Let SelectRenderable handle up/down/enter via its own focus
    return false;
  }
}
