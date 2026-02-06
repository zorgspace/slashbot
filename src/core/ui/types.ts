/**
 * OpenTUI Types - Shared interfaces for the TUI dashboard
 */

import type { StyledText } from '@opentui/core';

export interface UIOutput {
  appendChat(content: string): void;
  appendStyledChat(content: StyledText | string): void;
  appendThinking(chunk: string): void;
  clearThinking(): void;
  setThinkingVisible(visible: boolean): void;
  updateSidebar(data: SidebarData): void;
  focusInput(): void;
  showSpinner(label?: string): void;
  hideSpinner(): void;
  logPrompt(text: string): void;
  logResponse(chunk: string): void;
  endResponse(): void;
  logAction(action: string): void;
  logConnectorIn(source: string, message: string): void;
  logConnectorOut(source: string, response: string): void;
}

export interface SidebarData {
  connectors: { name: string; active: boolean }[];
  heartbeat: { running: boolean };
  tasks: { count: number };
  wallet: { unlocked: boolean };
  model: string;
}

export interface TUIAppCallbacks {
  onInput: (input: string) => Promise<void>;
  onExit: () => void;
  onAbort: () => void;
  onModelSelect: (model: string) => void;
}
