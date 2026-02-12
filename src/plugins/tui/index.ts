/**
 * TUI Plugin - Full-screen terminal UI dashboard
 *
 * Manages the OpenTUI-based dashboard with header, chat, comm panel, and input.
 * Wires into display singleton, spinner callbacks, and EventBus events.
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  KernelHookContribution,
} from '../types';
import { display, setTUISpinnerCallbacks } from '../../core/ui';

export class TUIPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.tui',
    name: 'TUI',
    version: '1.0.0',
    category: 'core',
    description: 'Full-screen terminal UI dashboard',
    contextInject: false,
  };
  private uiCallbacksBound = false;

  async init(_context: PluginContext): Promise<void> {
    // TUI initialization happens in onAfterGrokInit via Slashbot.start()
    // This plugin primarily serves as the new home for TUI code
  }

  getActionContributions(): ActionContribution[] {
    return [];
  }

  getPromptContributions(): PromptContribution[] {
    return [];
  }

  async destroy(): Promise<void> {
    this.uiCallbacksBound = false;
    setTUISpinnerCallbacks(null);
    display.setThinkingCallback(null);
  }

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'startup:after-ui-ready',
        order: 20,
        handler: payload => {
          if (this.uiCallbacksBound) {
            return;
          }
          const tuiApp = payload.tuiApp as
            | {
                appendThinking: (chunk: string, tabId?: string) => void;
                showSpinner: (label: string) => void;
                hideSpinner: () => void;
                logResponse: (chunk: string) => void;
                endResponse: () => void;
              }
            | undefined;
          if (!tuiApp) {
            return;
          }

          const getActiveTabId = payload.getActiveTabId as (() => string) | undefined;
          const getSessionIdForTab = payload.getSessionIdForTab as
            | ((tabId: string) => string | null)
            | undefined;
          const normalizeSpinnerLabel = payload.normalizeSpinnerLabel as
            | ((label: string | undefined) => string)
            | undefined;
          const isSessionReticulating = payload.isSessionReticulating as
            | ((sessionId: string) => boolean)
            | undefined;
          const setReticulatingLabel = payload.setReticulatingLabel as
            | ((sessionId: string, label: string) => void)
            | undefined;
          const syncActiveTabReticulatingIndicator = payload.syncActiveTabReticulatingIndicator as
            | (() => void)
            | undefined;
          const getGrokClient = payload.getGrokClient as (() => any) | undefined;

          if (
            !getActiveTabId ||
            !getSessionIdForTab ||
            !normalizeSpinnerLabel ||
            !isSessionReticulating ||
            !setReticulatingLabel ||
            !syncActiveTabReticulatingIndicator
          ) {
            return;
          }

          this.uiCallbacksBound = true;

          display.setThinkingCallback((chunk: string, tabId?: string) => {
            tuiApp.appendThinking(chunk, tabId);
          });

          setTUISpinnerCallbacks({
            showSpinner: (label: string, tabId?: string) => {
              const targetTabId = tabId || getActiveTabId();
              const targetSessionId = getSessionIdForTab(targetTabId);
              const normalized = normalizeSpinnerLabel(label);

              if (targetSessionId && isSessionReticulating(targetSessionId)) {
                setReticulatingLabel(targetSessionId, normalized);
                syncActiveTabReticulatingIndicator();
                return;
              }

              if (targetTabId === getActiveTabId()) {
                tuiApp.showSpinner(normalized);
              }
            },
            hideSpinner: (tabId?: string) => {
              const targetTabId = tabId || getActiveTabId();
              const targetSessionId = getSessionIdForTab(targetTabId);

              if (targetSessionId && isSessionReticulating(targetSessionId)) {
                syncActiveTabReticulatingIndicator();
                return;
              }

              if (targetTabId === getActiveTabId()) {
                tuiApp.hideSpinner();
              }
            },
          });

          const grokClient = getGrokClient?.();
          grokClient?.setRawOutputCallback?.((chunk: string) => {
            tuiApp.logResponse(chunk);
          });
          grokClient?.setResponseEndCallback?.(() => {
            tuiApp.endResponse();
          });
        },
      },
    ];
  }
}

// Re-export TUIApp for use by index.ts / kernel
export { TUIApp } from './TUIApp';
