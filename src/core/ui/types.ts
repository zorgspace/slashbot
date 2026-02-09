/**
 * OpenTUI Types - Shared interfaces for the TUI dashboard
 */

import type { StyledText } from '@opentui/core';

export interface UIOutput {
  appendChat(content: string): void;
  appendStyledChat(content: StyledText | string): void;
  appendCodeBlock(content: string, filetype?: string): void;
  appendDiffBlock(diff: string, filetype?: string): void;
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

export interface SidebarStatusItem {
  id: string;
  label: string;
  active: boolean;
  order?: number;
}

export interface SidebarData {
  model: string;
  items: SidebarStatusItem[];
}

export interface TUIAppCallbacks {
  onInput: (input: string) => Promise<void>;
  onExit: () => void;
  onAbort: () => void;
}
