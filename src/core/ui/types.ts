/**
 * OpenTUI Types - Shared interfaces for the TUI dashboard
 */

import type { StyledText } from '@opentui/core';

export interface UIOutput {
  appendChat(content: string, tabId?: string): void;
  appendStyledChat(content: StyledText | string, tabId?: string): void;
  appendUserChat(content: string, tabId?: string): void;
  appendAssistantChat(content: StyledText | string, tabId?: string): void;
  appendAssistantMarkdown(text: string, tabId?: string): void;
  upsertAssistantMarkdownBlock(key: string, text: string, tabId?: string): void;
  removeAssistantMarkdownBlock(key: string, tabId?: string): void;
  appendCodeBlock(content: string, filetype?: string, tabId?: string): void;
  appendDiffBlock(diff: string, filetype?: string, tabId?: string): void;
  appendThinking(chunk: string, tabId?: string): void;
  clearChat(tabId?: string): void;
  clearThinking(): void;
  startResponse(tabId?: string): void;
  appendResponse(chunk: string, tabId?: string): void;
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
  onAbort: (options?: { tabId?: string; source?: 'ctrl_c' | 'escape' }) => boolean;
  onTabChange?: (tabId: string) => void | Promise<void>;
  onCreateAgent?: () => void | Promise<void>;
  onEditAgent?: (agentId: string) => void | Promise<void>;
  onDeleteAgent?: (agentId: string) => void | Promise<void>;
}
