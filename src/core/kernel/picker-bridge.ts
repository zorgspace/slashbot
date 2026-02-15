import type { PickerItem } from '../../ui/picker-overlay.js';

export interface PickerResult {
  selected: string | null;   // id of chosen item, null if cancelled
}

export interface PickerRequest {
  id: string;
  title: string;
  items: PickerItem[];
  resolve: (result: PickerResult) => void;
}

/**
 * Bridges interactive picker overlays with the React TUI layer.
 * Plugins push picker requests through the bridge; the TUI renders
 * the overlay and resolves with the user's selection.
 */
export class PickerBridge {
  private listener: ((req: PickerRequest) => void) | null = null;

  onRequest(fn: (req: PickerRequest) => void): () => void {
    this.listener = fn;
    return () => { this.listener = null; };
  }

  request(title: string, items: PickerItem[]): Promise<PickerResult> {
    return new Promise((resolve) => {
      const req: PickerRequest = {
        id: `picker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        items,
        resolve,
      };
      if (this.listener) {
        this.listener(req);
      } else {
        resolve({ selected: null });
      }
    });
  }
}
