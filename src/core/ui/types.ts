/**
 * OpenTUI Types - Shared interfaces for the TUI dashboard
 */

import type { StyledText } from '@opentui/core';

export interface UIOutput {
  appendChat(content: string): void;
  appendStyledChat(content: StyledText | string): void;
  appendAssistantChat(content: StyledText | string): void;
  startAction(content: StyledText | string): void;
  appendActionContent(content: StyledText | string): void;
  completeAction(content: StyledText | string): void;
  startResponse(): void;
  appendResponse(chunk: string): void;
  endResponse(): void;
  startAssistantBlock(): void;
  appendAssistantBlockLine(content: StyledText | string): void;
  addAssistantBlockCode(content: string, filetype?: string): void;
  endAssistantBlock(): void;
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
  promptInput(prompt: string): Promise<string>;
  showNotification(text: string): void;
  updateNotificationList(items: { id: string; content: string; status: string }[]): void;
}

export interface SidebarStatusItem {
  id: string;
  label: string;
  active: boolean;
  order?: number;
}

export interface SidebarData {
  model: string;
  provider: string;
  availableModels: string[];
  items: SidebarStatusItem[];
}

export interface TUIApp {
  destroy(): void;
}

export interface TUIAppCallbacks {
  onInput: (input: string) => Promise<void>;
  onExit: () => void;
  onAbort: () => void;
}
