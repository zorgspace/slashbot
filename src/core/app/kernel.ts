/**
 * Slashbot Kernel - Core orchestrator class
 */

import * as path from 'path';

import {
  display,
  formatToolAction,
  parseLegacyToolLine,
  summarizeToolResult,
  humanizeToolName,
  isAssistantToolTranscript,
  isExploreToolName,
} from '../ui';
import type { SidebarData } from '../ui/types';
import { createGrokClient, GrokClient } from '../api';
import { parseInput, executeCommand, CommandContext, completer } from '../commands/parser';
import type { ConnectorSource } from '../../connectors/base';
import { setTUISpinnerCallbacks } from '../ui';
import { TUIApp } from '../../plugins/tui/TUIApp';
import type { TabItem } from '../../plugins/tui/panels/TabsPanel';
import { expandPaste, getLastPaste, getLastPasteSummary } from '../../plugins/tui/pasteHandler';
import { loadHistoryFromDisk, writeContextDump, writeHistoryToDisk } from './persistence';
import {
  buildAgentTabs as buildAgentTabItems,
  buildConnectorTabs as buildConnectorTabItems,
  type ConnectorTabInfo,
} from './tabBuilder';
import {
  createPluginRuntimeContext,
  buildSidebarData as buildBaseSidebarData,
  initializeConnectorPlugins,
} from './bootstrap';

// DI imports
import { initializeContainer, getService, TYPES, container } from '../di/container';
import type { ConfigManager } from '../config/config';
import type { CodeEditor } from '../../plugins/code-editor/services/CodeEditor';
import type { CommandPermissions } from '../../plugins/system/services/CommandPermissions';
import type { SecureFileSystem } from '../../plugins/filesystem/services/SecureFileSystem';
import type { ConnectorRegistry, ConnectorSnapshot } from '../../connectors/registry';
import type { EventBus } from '../events/EventBus';
import type { GatewayWebhookPayload } from '../gateway/protocol';
import type {
  AgentOrchestratorService,
  AgentProfile,
  AgentRoutingRequest,
  AgentRoutingDecision,
} from '../../plugins/agents/services';

// Plugin system imports
import { PluginRegistry } from '../../plugins/registry';
import { loadAllPlugins } from '../../plugins/loader';
import { PromptAssembler } from '../api/prompts/assembler';
import { ToolRegistry } from '../api/toolRegistry';
import { buildHandlersFromContributions, buildExecutorMap } from '../../plugins/utils';
import { setDynamicExecutorMap } from '../actions/executor';
import type { ConnectorPlugin, PluginContext } from '../../plugins/types';
import { cleanXmlTags, cleanSelfDialogue, unwrapMarkdownTags } from '../utils/xml';

export interface SlashbotConfig {
  basePath?: string;
}

const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const;
const MAX_AGENT_BOOTSTRAP_FILE_CHARS = 2400;
const MAX_AGENT_BOOTSTRAP_TOTAL_CHARS = 10000;
const CONNECTOR_AGENT_MIRROR_DISABLED = new Set(['telegram', 'discord']);
const SPECIALIST_BLOCKED_TOOL_NAMES = [
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_usage',
  'sessions_compaction',
  'agents_status',
  'agents_list',
  'agents_tasks',
  'agents_create',
  'agents_update',
  'agents_delete',
  'agents_run',
  'agents_verify',
  'agents_recall',
];
const SPECIALIST_BLOCKED_ACTION_TYPES = [
  'sessions-list',
  'sessions-history',
  'sessions-send',
  'sessions-usage',
  'sessions-compaction',
  'agent-status',
  'agent-list',
  'agent-tasks',
  'agent-create',
  'agent-update',
  'agent-delete',
  'agent-run',
  'agent-verify',
  'agent-recall',
];

export class Slashbot {
  private grokClient: GrokClient | null = null;
  private configManager!: ConfigManager;
  private codeEditor!: CodeEditor;
  private commandPermissions!: CommandPermissions;
  private fileSystem!: SecureFileSystem;
  private connectorRegistry!: ConnectorRegistry;
  private eventBus!: EventBus;
  private pluginRegistry!: PluginRegistry;
  private promptAssembler!: PromptAssembler;
  private toolRegistry!: ToolRegistry;
  private automationService: { handleWebhookTrigger?: (payload: GatewayWebhookPayload) => Promise<number> } | null =
    null;
  private running = false;
  private history: string[] = [];
  private loadedContextFile: string | null = null;
  private historySaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private basePath?: string;
  private tuiApp: TUIApp | null = null;
  private agentService: AgentOrchestratorService | null = null;
  private agentsManagerRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeCliRequestSessionId: string | null = null;
  private readonly unreadByTab = new Map<string, number>();
  private readonly reticulatingBySession = new Map<string, number>();
  private readonly reticulatingLabelBySession = new Map<string, string>();
  private readonly connectorTabs = new Map<string, ConnectorTabInfo>();
  private activeReticulatingSessionId: string | null = null;
  private activeReticulatingLabel: string | null = null;
  private lastExpandedInput = '';
  private version = '';
  private readonly SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerFrame = 0;
  private tabSpinnerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: SlashbotConfig = {}) {
    this.basePath = config.basePath;
  }

  setVersion(version: string): void {
    this.version = version;
  }

  isConnected(): boolean {
    return !!this.grokClient;
  }

  getCurrentModel(): string | null {
    return this.grokClient?.getCurrentModel?.() || null;
  }

  getCurrentProvider(): string | null {
    return this.grokClient?.getProvider?.() || null;
  }

  getSessionSummaries(): Array<{
    id: string;
    messageCount: number;
    lastActivity: number;
    lastRole: string | null;
    preview: string;
  }> {
    return this.grokClient?.getSessionSummaries?.() || [];
  }

  getConnectorSnapshots(): ConnectorSnapshot[] {
    return this.connectorRegistry?.getSnapshots?.() || [];
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Initialize DI container and get services
   */
  private async initializeServices(): Promise<void> {
    await initializeContainer({ basePath: this.basePath });

    // Resolve core services (bound by initializeContainer)
    this.configManager = getService<ConfigManager>(TYPES.ConfigManager);
    this.connectorRegistry = getService<ConnectorRegistry>(TYPES.ConnectorRegistry);
    this.eventBus = getService<EventBus>(TYPES.EventBus);

    // Load config before plugins init (plugins need credentials during init)
    await this.configManager.load();

    // Initialize plugin system
    this.pluginRegistry = new PluginRegistry();
    this.promptAssembler = new PromptAssembler();

    // Load and register all plugins (built-in + installed)
    const plugins = await loadAllPlugins();
    this.pluginRegistry.registerAll(plugins);

    // Set plugin context and initialize all plugins
    // Note: configManager.getWorkDir() not available yet, plugins that need workDir
    // get it from their own init. Pass empty string; overwritten after codeEditor resolves.
    this.pluginRegistry.setContext(
      createPluginRuntimeContext({
        container,
        eventBus: this.eventBus,
        configManager: this.configManager,
        workDir: process.cwd(),
        getGrokClient: () => this.grokClient,
      }),
    );
    await this.pluginRegistry.initAll();

    // Resolve plugin-registered services (bound during plugin init)
    this.codeEditor = getService<CodeEditor>(TYPES.CodeEditor);
    this.codeEditor.setEventBus(this.eventBus);
    this.commandPermissions = getService<CommandPermissions>(TYPES.CommandPermissions);
    this.fileSystem = getService<SecureFileSystem>(TYPES.FileSystem);
    if (container.isBound(TYPES.AgentOrchestratorService)) {
      this.agentService = getService<AgentOrchestratorService>(TYPES.AgentOrchestratorService);
    }
    if (container.isBound(TYPES.AutomationService)) {
      this.automationService = getService<any>(TYPES.AutomationService);
    }

    // Wire plugin contributions into the action system
    const actionContributions = this.pluginRegistry.getActionContributions();
    const pluginHandlers = buildHandlersFromContributions(actionContributions);
    const executorMap = buildExecutorMap(actionContributions);
    setDynamicExecutorMap(executorMap);

    // Wire plugin command contributions into the CommandRegistry
    const commandRegistry = getService<any>(TYPES.CommandRegistry);
    const pluginCommands = this.pluginRegistry.getCommandContributions();
    commandRegistry.registerAll(pluginCommands);

    // Wire prompt contributions into the assembler
    this.promptAssembler.setContributions(this.pluginRegistry.getPromptContributions());
    this.promptAssembler.setContextProviders(this.pluginRegistry.getContextProviders());

    // Wire tool contributions into the ToolRegistry
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.register(this.pluginRegistry.getToolContributions());
    container.bind(TYPES.ToolRegistry).toConstantValue(this.toolRegistry);

    // Wire plugin event subscriptions into the EventBus
    const pluginEventSubscriptions = this.pluginRegistry.getEventSubscriptions();
    for (const subscription of pluginEventSubscriptions) {
      this.eventBus.on(subscription.event, subscription.handler);
    }
  }

  private getContext(): CommandContext {
    return {
      grokClient: this.grokClient,
      fileSystem: this.fileSystem,
      configManager: this.configManager,
      codeEditor: this.codeEditor,
      container,
      connectors: this.connectorRegistry.getAll(),
      reinitializeGrok: () => this.initializeGrok(),
      tuiApp: this.tuiApp ?? undefined,
    };
  }

  abortCurrentOperation(): void {
    if (this.grokClient) {
      this.grokClient.abort();
    }
  }

  isThinking(): boolean {
    return this.grokClient?.isThinking() ?? false;
  }

  getTUI(): TUIApp | null {
    return this.tuiApp;
  }

  private getCliActiveTabId(): string {
    return this.tuiApp?.getActiveTabId() || this.agentService?.getActiveAgentId() || 'agents';
  }

  private syncInputAvailabilityForTab(tabId: string): void {
    if (!this.tuiApp) {
      return;
    }

    if (tabId === 'agents') {
      this.tuiApp.setInputEnabled(false, {
        placeholder: 'Overview is read-only. Select an agent or connector tab.',
      });
      return;
    }

    const connectorTab = this.resolveConnectorTabInfo(tabId);
    if (connectorTab) {
      const summary = getLastPasteSummary();
      const placeholder = `Send to ${connectorTab.label}...`;
      this.tuiApp.setInputEnabled(true, {
        placeholder: summary ? `${summary} ${placeholder}` : placeholder,
      });
      return;
    }

    const summary = getLastPasteSummary();
    this.tuiApp.setInputEnabled(true, {
      placeholder: summary ? `${summary} Type your message...` : 'Type your message...',
    });
  }

  private isConnectorSessionId(value: string): boolean {
    const idx = value.indexOf(':');
    if (idx <= 0 || idx >= value.length - 1) {
      return false;
    }

    const source = value.slice(0, idx).trim().toLowerCase();
    if (!source || source === 'agent' || source === 'cli') {
      return false;
    }

    if (this.connectorRegistry?.has(source)) {
      return true;
    }

    return (
      this.connectorRegistry
        ?.getSnapshots()
        .some(snapshot => snapshot.id.toLowerCase() === source) ?? false
    );
  }

  private getConnectorTabInfo(tabId: string): ConnectorTabInfo | null {
    return this.connectorTabs.get(tabId) || null;
  }

  private resolveConnectorTabInfo(tabId: string): ConnectorTabInfo | null {
    const mapped = this.getConnectorTabInfo(tabId);
    if (mapped) {
      return mapped;
    }

    const parsed = this.parseConnectorSessionId(tabId);
    if (!parsed) {
      return null;
    }

    const source = parsed.source.trim().toLowerCase();
    const targetId = parsed.targetId.trim();
    if (!source || !targetId) {
      return null;
    }

    const label = `${source.charAt(0).toUpperCase() + source.slice(1)} ${targetId}`;
    return {
      tabId,
      source,
      targetId,
      sessionId: tabId,
      label,
    };
  }

  private getSessionIdForTab(tabId: string): string | null {
    if (tabId === 'agents') {
      return null;
    }
    if (tabId === 'main') {
      return 'cli';
    }
    const connectorTab = this.getConnectorTabInfo(tabId);
    if (connectorTab) {
      return connectorTab.sessionId;
    }
    if (this.agentService) {
      const agentSessionId = this.agentService.getAgent(tabId)?.sessionId;
      if (agentSessionId) {
        return agentSessionId;
      }
    }
    if (this.isConnectorSessionId(tabId)) {
      return tabId;
    }
    return null;
  }

  private isSessionReticulating(sessionId: string): boolean {
    return (this.reticulatingBySession.get(sessionId) || 0) > 0;
  }

  private normalizeSpinnerLabel(label: string | undefined): string {
    const compact = (label || '').replace(/\s+/g, ' ').trim();
    if (!compact) {
      return 'Reticulating...';
    }
    return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  }

  private setReticulatingLabel(sessionId: string, label: string): void {
    this.reticulatingLabelBySession.set(sessionId, this.normalizeSpinnerLabel(label));
  }

  private getReticulatingLabel(sessionId: string): string {
    return this.reticulatingLabelBySession.get(sessionId) || 'Reticulating...';
  }

  private syncActiveTabReticulatingIndicator(): void {
    if (!this.tuiApp) {
      return;
    }
    const activeTabId = this.getCliActiveTabId();
    const activeSessionId = this.getSessionIdForTab(activeTabId);
    const shouldShow =
      !!activeSessionId && (this.reticulatingBySession.get(activeSessionId) || 0) > 0;

    if (shouldShow && activeSessionId) {
      const nextLabel = this.getReticulatingLabel(activeSessionId);
      if (
        this.activeReticulatingSessionId !== activeSessionId ||
        this.activeReticulatingLabel !== nextLabel
      ) {
        this.tuiApp.showSpinner(nextLabel);
        this.activeReticulatingSessionId = activeSessionId;
        this.activeReticulatingLabel = nextLabel;
      }
      return;
    }

    if (this.activeReticulatingSessionId) {
      this.tuiApp.hideSpinner();
      this.activeReticulatingSessionId = null;
      this.activeReticulatingLabel = null;
    }
  }

  private beginReticulatingSession(sessionId: string, label = 'Reticulating...'): void {
    this.reticulatingBySession.set(sessionId, (this.reticulatingBySession.get(sessionId) || 0) + 1);
    this.setReticulatingLabel(sessionId, label);
    if (this.reticulatingBySession.size > 0 && !this.tabSpinnerInterval) {
      this.tabSpinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % this.SPINNER_FRAMES.length;
        this.refreshAgentTabs();
      }, 150);
    }
    this.refreshAgentTabs();
    this.syncActiveTabReticulatingIndicator();
  }

  private endReticulatingSession(sessionId: string): void {
    const count = this.reticulatingBySession.get(sessionId) || 0;
    if (count <= 1) {
      this.reticulatingBySession.delete(sessionId);
      this.reticulatingLabelBySession.delete(sessionId);
    } else {
      this.reticulatingBySession.set(sessionId, count - 1);
    }
    if (this.reticulatingBySession.size === 0 && this.tabSpinnerInterval) {
      clearInterval(this.tabSpinnerInterval);
      this.tabSpinnerInterval = null;
    }
    this.refreshAgentTabs();
    this.syncActiveTabReticulatingIndicator();
  }

  private getUnreadCount(tabId: string): number {
    return this.unreadByTab.get(tabId) ?? 0;
  }

  private bumpTabUnread(tabId: string, delta = 1): void {
    if (!this.tuiApp || tabId === 'agents' || delta <= 0) {
      return;
    }
    this.unreadByTab.set(tabId, this.getUnreadCount(tabId) + delta);
    this.refreshAgentTabs();
  }

  private clearTabUnread(tabId: string, options?: { refresh?: boolean }): void {
    if (tabId === 'agents') {
      return;
    }
    const removed = this.unreadByTab.delete(tabId);
    if (removed && options?.refresh !== false) {
      this.refreshAgentTabs();
    }
  }

  private toolMessageHasRenderableEntries(msg: any): boolean {
    const isControlTool = (name: string): boolean => {
      const normalized = name.trim().toLowerCase();
      return (
        normalized === 'say_message' || normalized === 'end_task' || normalized === 'continue_task'
      );
    };
    const toolResults = Array.isArray(msg?.toolResults) ? msg.toolResults : [];
    if (toolResults.length > 0) {
      return toolResults.some(item => !isControlTool(String(item?.toolName || '')));
    }
    const fallback = parseLegacyToolLine(this.toTextContent(msg?.content));
    return !isControlTool(fallback.toolName);
  }

  private messageWouldRenderInAgentHistory(msg: any, options?: { includeUser?: boolean }): boolean {
    const includeUser = options?.includeUser ?? false;
    const raw = this.toTextContent(msg?.content, msg?.role).trim();
    if (!raw) {
      return false;
    }
    const render = this.resolveRenderMetadata(msg, raw);
    if (render.kind === 'skip') {
      return false;
    }
    if (render.kind === 'user') {
      return includeUser;
    }
    if (render.kind === 'tool') {
      return this.toolMessageHasRenderableEntries(msg);
    }
    return true;
  }

  private countRenderableAgentMessages(messages: any[]): number {
    let count = 0;
    for (const msg of messages) {
      if (this.messageWouldRenderInAgentHistory(msg, { includeUser: false })) {
        count += 1;
      }
    }
    return count;
  }

  private ensureRenderableAssistantFallback(
    sessionId: string,
    newMessages: any[],
    fallbackResponse: string,
  ): boolean {
    const normalized = this.cleanAssistantRenderableText(fallbackResponse);
    if (!this.grokClient || !normalized) {
      return false;
    }
    const hasRenderable = newMessages.some(msg =>
      this.messageWouldRenderInAgentHistory(msg, { includeUser: false }),
    );
    if (hasRenderable) {
      return false;
    }
    const alreadyPresent = newMessages.some(msg => {
      if (msg?.role !== 'assistant') {
        return false;
      }
      return this.toTextContent(msg.content, msg.role).trim() === normalized;
    });
    if (alreadyPresent) {
      return false;
    }
    this.grokClient.addMessageToSession(sessionId, {
      role: 'assistant',
      content: normalized,
      _render: {
        kind: 'assistant_markdown',
        text: normalized,
      },
    });
    return true;
  }

  private cleanAssistantRenderableText(text: string): string {
    return unwrapMarkdownTags(cleanSelfDialogue(cleanXmlTags(text)))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private formatLLMErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = raw.replace(/\s+/g, ' ').trim();
    return normalized || 'Unknown LLM error';
  }

  private persistAssistantMarkdownToSession(
    sessionId: string | null | undefined,
    text: string,
  ): void {
    if (!sessionId || !this.grokClient) {
      return;
    }
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    const history = this.grokClient.getHistoryForSession(sessionId);
    const lastAssistant = [...history].reverse().find(msg => msg?.role === 'assistant');
    if (lastAssistant) {
      const lastText = this.toTextContent(lastAssistant.content, lastAssistant.role).trim();
      if (lastText === normalized) {
        return;
      }
    }
    this.grokClient.addMessageToSession(sessionId, {
      role: 'assistant',
      content: normalized,
      _render: {
        kind: 'assistant_markdown',
        text: normalized,
      },
    });
  }

  private surfaceLLMErrorInChat(
    error: unknown,
    options?: { sessionId?: string | null; tabId?: string; context?: string },
  ): string {
    const errorMsg = this.formatLLMErrorMessage(error);
    const context = options?.context?.trim();
    const detail = context ? `${context}: ${errorMsg}` : errorMsg;
    const markdown = context
      ? `**LLM Error**\n${context}\n\n${errorMsg}`
      : `**LLM Error**\n${errorMsg}`;
    this.persistAssistantMarkdownToSession(options?.sessionId, markdown);
    display.withOutputTab(options?.tabId, () => display.errorBlock(`LLM Error: ${detail}`));
    return errorMsg;
  }

  private handleAgentTaskFailed(event: {
    agentId?: string;
    error?: string;
    task?: { id?: string; title?: string; error?: string };
  }): void {
    if (!this.agentService) {
      return;
    }
    const agentId = typeof event.agentId === 'string' ? event.agentId : '';
    if (!agentId) {
      return;
    }
    const agent = this.agentService.getAgent(agentId);
    if (!agent) {
      return;
    }
    const taskTitle = typeof event.task?.title === 'string' ? event.task.title.trim() : '';
    const taskId = typeof event.task?.id === 'string' ? event.task.id.trim() : '';
    const context = taskTitle
      ? `Task "${taskTitle}" failed`
      : taskId
        ? `Task ${taskId} failed`
        : 'Task failed';
    this.surfaceLLMErrorInChat(event.error || event.task?.error || 'Unknown task failure', {
      sessionId: agent.sessionId,
      tabId: agent.id,
      context,
    });
  }

  private isInternalUserMessage(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      normalized.includes('<system-instruction>') ||
      normalized.includes('<session-actions>') ||
      normalized.includes('[ralph-nudge]') ||
      normalized.includes('you stalled (no actionable progress detected).') ||
      normalized.includes('do not restate plans. execute immediately.') ||
      normalized.includes('continue or <end> to finish.') ||
      normalized.includes('critical: you stopped mid-task.')
    );
  }

  private isInternalAssistantMessage(text: string): boolean {
    const normalized = text.toLowerCase();
    return normalized.includes('<session-actions>') || normalized.includes('[ralph-nudge]');
  }

  private shouldPreferWebSearchForConnectorQuery(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const webLookupSignals = [
      /\bweather\b/,
      /\bforecast\b/,
      /\btemperature\b/,
      /\btoday\b/,
      /\btomorrow\b/,
      /\byesterday\b/,
      /\blatest\b/,
      /\bcurrent\b/,
      /\bnews\b/,
      /\bheadline\b/,
      /\bprice\b/,
      /\bstock\b/,
      /\bquote\b/,
      /\btweet\b/,
      /\btwitter\b/,
      /\bx\.com\b/,
      /\blast tweet\b/,
      /\bwhat'?s new\b/,
      /\bsearch\b/,
    ];
    return webLookupSignals.some(pattern => pattern.test(normalized));
  }

  private extractRenderableUserMessage(text: string): string {
    const normalized = text.replace(/^\[you\]\s*/i, '').trim();
    if (!normalized) {
      return '';
    }
    const strippedSystemInstruction = normalized
      .replace(/^<system-instruction>[\s\S]*?<\/system-instruction>\s*/i, '')
      .trim();
    return strippedSystemInstruction || normalized;
  }

  private abortJobsInTab(options?: { tabId?: string; source?: 'ctrl_c' | 'escape' }): boolean {
    const source = options?.source || 'ctrl_c';
    const tabId = options?.tabId || this.getCliActiveTabId();
    const agent = this.getAgentForTab(tabId);
    const targetSessionId = this.getSessionIdForTab(tabId) || 'cli';
    let aborted = false;

    const sessionAborted = this.grokClient?.abortSession(targetSessionId) ?? false;
    if (sessionAborted) {
      aborted = true;
    }

    if (
      !sessionAborted &&
      this.grokClient?.isThinking() &&
      this.activeCliRequestSessionId &&
      this.activeCliRequestSessionId === targetSessionId
    ) {
      this.grokClient.abort();
      aborted = true;
    }

    if (agent && this.agentService) {
      const stats = this.agentService.getTaskStatsForAgent(agent.id);
      if (stats.queued > 0 || stats.running > 0) {
        aborted = true;
        void this.agentService
          .abandonJobsForAgent(agent.id, `Aborted via ${source.toUpperCase()} in tab ${tabId}`)
          .then(({ queuedRemoved, runningCount }) => {
            if (queuedRemoved > 0 || runningCount > 0) {
              display.warningText(
                `Aborted ${agent.name}: removed ${queuedRemoved} queued job(s), ${runningCount} running job(s) signaled`,
              );
            }
          })
          .catch(() => {
            // Best effort abort path; ignore persistence errors.
          });
      }
    }

    return aborted;
  }

  private getAgentForTab(tabId: string): AgentProfile | null {
    if (!this.agentService) return null;
    if (tabId === 'agents') return null;
    return this.agentService.getAgent(tabId);
  }

  private hashPrompt(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  private isOrchestratorAgent(agent: AgentProfile): boolean {
    if (agent.kind === 'architect') {
      return true;
    }
    const label = `${agent.name} ${agent.responsibility}`.toLowerCase();
    return (
      label.includes('orchestrator') || label.includes('architect') || label.includes('coordinator')
    );
  }

  private buildSpecialistExecutionPolicy(): {
    blockedToolNames: string[];
    blockedActionTypes: string[];
    blockReason: string;
  } {
    return {
      blockedToolNames: [...SPECIALIST_BLOCKED_TOOL_NAMES],
      blockedActionTypes: [...SPECIALIST_BLOCKED_ACTION_TYPES],
      blockReason:
        'Specialist lanes execute implementation directly. Use <agent-send> for escalation/reporting; do not use sessions_* or agent-management orchestration tools.',
    };
  }

  private buildTabPromptDirectives(agent: AgentProfile): string[] {
    if (this.isOrchestratorAgent(agent)) {
      return [
        'Tab mode: ORCHESTRATOR.',
        'Use this tab only for planning, delegation, and verification.',
        'Run a short preflight analysis in this tab before delegating.',
        'Before delegating for a user request, inspect available agents first (agents_status / agents_list) and choose the most adequate specialist.',
        'Prefer reusing existing specialist tabs/agents when they match the task.',
        'If no adequate specialist exists, create or retask one before delegating. Do not spawn a new agent for every request.',
        'Never implement directly in this tab. Delegate implementation to specialist agents with agents_send.',
        'Require specialists to report completion evidence back before you close the request.',
      ];
    }
    return [
      'Tab mode: SPECIALIST.',
      'The user is speaking directly to this tab/agent. Execute the request now in this session.',
      'Do NOT delegate with agents_send unless the user explicitly asks delegation or you are blocked by ownership.',
      'Never delegate to yourself.',
      'When work is delegated from another agent, report completion back to that sender before end_task.',
    ];
  }

  private connectorAgentIdFromSource(source: ConnectorSource): string {
    const normalized = String(source || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `agent-${normalized || 'connector'}agent`;
  }

  private shouldMirrorConnectorAsAgent(connectorId: string): boolean {
    return !CONNECTOR_AGENT_MIRROR_DISABLED.has(connectorId.trim().toLowerCase());
  }

  private buildVirtualConnectorProfile(options: {
    connectorId: string;
    label: string;
    sessionId: string;
  }): AgentProfile {
    const connectorId = options.connectorId.trim().toLowerCase();
    const connectorLabel = options.label.trim() || connectorId;
    const connector = connectorId.toUpperCase();
    const now = new Date().toISOString();
    const connectorRoot = path.join(this.basePath || process.cwd(), '.connectors', connectorId);

    return {
      id: `connector-${connectorId}`,
      name: `${connectorLabel} Connector`,
      kind: 'connector',
      responsibility: `${connectorLabel} connector operations specialist. Handle ${connectorId} requests safely.`,
      systemPrompt: `You are ${connectorLabel} Connector, the ${connector} connector agent.

Your core responsibility: ${connectorLabel} connector operations specialist. Handle ${connectorId} requests safely.

Execution policy:
- Handle inbound ${connector} requests directly with available tools.
- Keep responses concise and platform-safe for connector users.
- Execute required actions (read/edit/write/bash/tools) without unnecessary delegation.
- Delegate only when blocked by missing ownership or specialization.

Communication rules:
- Use clear, short progress/status updates.
- End with brief plain-language summaries when a request is complete.`,
      sessionId: options.sessionId,
      workspaceDir: connectorRoot,
      agentDir: path.join(connectorRoot, 'agent'),
      enabled: true,
      autoPoll: false,
      removable: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async readAgentBootstrapSections(agent: AgentProfile): Promise<string[]> {
    const sections: string[] = [];
    let totalChars = 0;

    for (const fileName of AGENT_BOOTSTRAP_FILES) {
      if (totalChars >= MAX_AGENT_BOOTSTRAP_TOTAL_CHARS) {
        break;
      }

      const filePath = path.join(agent.workspaceDir, fileName);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        continue;
      }

      const raw = await file.text();
      if (!raw.trim()) {
        continue;
      }

      const remaining = MAX_AGENT_BOOTSTRAP_TOTAL_CHARS - totalChars;
      if (remaining <= 0) {
        break;
      }

      const limit = Math.min(MAX_AGENT_BOOTSTRAP_FILE_CHARS, remaining);
      const truncated = raw.length > limit;
      const content = truncated ? raw.slice(0, limit) : raw;
      sections.push(`## ${fileName}\n${content}${truncated ? '\n\n[truncated]' : ''}`);
      totalChars += content.length;
    }

    return sections;
  }

  private async ensureSessionProfile(options: {
    agent: AgentProfile;
    sessionId: string;
    contextHeader: string;
    directives: string[];
    executionDirective: string;
    coordinationDirective: string;
    extraContextLines?: string[];
  }): Promise<void> {
    if (!this.grokClient) return;

    const bootstrapSections = await this.readAgentBootstrapSections(options.agent);
    const bootstrapDigest = this.hashPrompt(bootstrapSections.join('\n\n'));
    const markerPayload = [
      options.agent.systemPrompt,
      options.contextHeader,
      ...options.directives,
      options.executionDirective,
      options.coordinationDirective,
      ...(options.extraContextLines || []),
      `bootstrap:${bootstrapDigest}`,
    ].join('\n');
    const marker = `agent-profile:${options.agent.id}:v6:${this.hashPrompt(markerPayload)}`;
    const history = this.grokClient.getHistoryForSession(options.sessionId);
    const hasProfile = history.some(
      msg =>
        msg.role === 'system' &&
        typeof msg.content === 'string' &&
        msg.content.includes(`<!-- ${marker} -->`),
    );
    if (hasProfile) {
      return;
    }

    const payloadLines: string[] = [
      `<!-- ${marker} -->`,
      options.contextHeader,
      'Use this latest tab profile and ignore older tab-profile instructions in this session.',
      options.agent.systemPrompt,
      ...options.directives,
      options.executionDirective,
      options.coordinationDirective,
      'Avoid loops on coordination tools; if blocked, state the blocker precisely and what you already tried.',
      'Use say_message for progress; use end_task only when the delegated task is complete.',
      `Workspace: ${options.agent.workspaceDir}`,
      `AgentDir: ${options.agent.agentDir}`,
      ...(options.extraContextLines || []),
    ];
    if (bootstrapSections.length > 0) {
      payloadLines.push('Workspace bootstrap files:', bootstrapSections.join('\n\n'));
    }

    this.grokClient.addMessageToSession(options.sessionId, {
      role: 'system',
      content: payloadLines.join('\n'),
    });
  }

  private async ensureAgentSession(agent: AgentProfile): Promise<void> {
    const directives = this.buildTabPromptDirectives(agent);
    const isOrchestrator = this.isOrchestratorAgent(agent);
    const executionDirective = isOrchestrator
      ? 'Execution default: orchestrate only. Do not edit code or run implementation commands directly in this tab.'
      : 'Execution default: work autonomously with read/edit/write/bash/test tools in your workspace.';
    const coordinationDirective = isOrchestrator
      ? 'Use agents_status/agents_send/sessions_* for coordination and routing; avoid noisy coordination loops.'
      : 'Use agents_send only when blocked by missing ownership or missing context. Do not use sessions_* from specialist lanes.';
    await this.ensureSessionProfile({
      agent,
      sessionId: agent.sessionId,
      contextHeader: `[tab-context] ${agent.name} (${agent.id})`,
      directives,
      executionDirective,
      coordinationDirective,
    });
  }

  private async ensureConnectorSession(source: ConnectorSource, sessionId: string): Promise<void> {
    if (!this.grokClient) return;

    const connectorId = String(source || '')
      .trim()
      .toLowerCase();
    if (!connectorId || connectorId === 'cli') return;

    const snapshot = this.connectorRegistry
      .getSnapshots()
      .find(item => item.id.toLowerCase() === connectorId);
    const label = snapshot?.id
      ? snapshot.id.charAt(0).toUpperCase() + snapshot.id.slice(1)
      : connectorId.charAt(0).toUpperCase() + connectorId.slice(1);

    let connectorAgent: AgentProfile | null = null;
    if (this.shouldMirrorConnectorAsAgent(connectorId) && this.agentService) {
      connectorAgent = this.agentService.getAgent(this.connectorAgentIdFromSource(source));
      if (
        !connectorAgent ||
        connectorAgent.kind !== 'connector' ||
        connectorAgent.removable !== false
      ) {
        connectorAgent = await this.agentService.ensureConnectorAgent({
          connectorId,
          label,
        });
      }
    }
    if (!connectorAgent) {
      connectorAgent = this.buildVirtualConnectorProfile({
        connectorId,
        label,
        sessionId,
      });
    }

    const parsed = this.parseConnectorSessionId(sessionId);
    const targetId = parsed?.targetId || '';
    await this.ensureSessionProfile({
      agent: connectorAgent,
      sessionId,
      contextHeader: `[connector-context] ${label} (${connectorAgent.id})`,
      directives: [
        'Tab mode: CONNECTOR.',
        `This session handles ${label} connector traffic.`,
        'Execute actions directly to satisfy connector user requests.',
        'Connector responses must stay concise and plain-language.',
      ],
      executionDirective:
        'Execution default: handle connector user requests directly with available tools in this lane.',
      coordinationDirective:
        'Use agents_status/agents_send/sessions_* only when blocked by missing ownership or context; avoid coordination loops.',
      extraContextLines: [
        `Connector source: ${connectorId}`,
        ...(targetId ? [`Connector target: ${targetId}`] : []),
        `Connector session: ${sessionId}`,
      ],
    });
  }

  private async ensureGatewaySession(sessionId: string, clientId?: string): Promise<void> {
    if (!this.grokClient) return;

    const normalizedClientId = String(clientId || 'gateway-client')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();

    const gatewayAgent = this.buildVirtualConnectorProfile({
      connectorId: 'gateway',
      label: 'Gateway',
      sessionId,
    });

    await this.ensureSessionProfile({
      agent: gatewayAgent,
      sessionId,
      contextHeader: `[gateway-context] Remote gateway client (${normalizedClientId})`,
      directives: [
        'Tab mode: GATEWAY.',
        'This session handles remote gateway traffic.',
        'Respond with the same level of rigor as CLI mode.',
        'If tool actions are required, execute them before your final response.',
      ],
      executionDirective:
        'Execution default: handle gateway user requests directly with available tools in this lane.',
      coordinationDirective:
        'Use agents_status/agents_send/sessions_* only when blocked by missing ownership or context.',
      extraContextLines: [`Gateway session: ${sessionId}`, `Gateway client: ${normalizedClientId}`],
    });
  }

  async processGatewayMessage(options: {
    message: string;
    sessionId?: string;
    clientId?: string;
    onChunk?: (chunk: string) => void;
  }): Promise<{ response: string; sessionId: string }> {
    const message = String(options.message || '').trim();
    if (!message) {
      throw new Error('Message cannot be empty');
    }
    if (!this.grokClient) {
      throw new Error('Grok client is not initialized');
    }

    const normalizedClientId = String(options.clientId || 'gateway-client')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
    const sessionId =
      String(options.sessionId || '').trim() || `gateway:${normalizedClientId || 'default'}`;

    await this.ensureGatewaySession(sessionId, normalizedClientId);

    const result = await this.grokClient.chat(message, {
      sessionId,
      displayResult: false,
      quiet: true,
      onOutputChunk: options.onChunk,
    });

    await this.dumpContext();

    return {
      response: result.response,
      sessionId,
    };
  }

  async handleGatewayWebhook(
    payload: GatewayWebhookPayload,
  ): Promise<{ matchedJobs: number }> {
    let matchedJobs = 0;
    if (this.automationService?.handleWebhookTrigger) {
      try {
        matchedJobs = await this.automationService.handleWebhookTrigger(payload);
      } catch {
        matchedJobs = 0;
      }
    }
    this.eventBus.emit({
      type: 'gateway:webhook',
      ...payload,
      matchedJobs,
    });
    return { matchedJobs };
  }

  private async syncConnectorAgents(): Promise<void> {
    if (!this.agentService) return;
    const snapshots = this.connectorRegistry
      .getSnapshots()
      .filter(snapshot => snapshot.configured || snapshot.running);
    for (const snapshot of snapshots) {
      if (!this.shouldMirrorConnectorAsAgent(snapshot.id)) {
        continue;
      }
      const label = snapshot.id.charAt(0).toUpperCase() + snapshot.id.slice(1);
      await this.agentService.ensureConnectorAgent({
        connectorId: snapshot.id,
        label,
      });
    }
  }

  private compactRoutingText(text: string, maxChars = 280): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) {
      return compact;
    }
    return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
  }

  private buildOrchestratorAgentRosterSnapshot(orchestratorId: string): string {
    if (!this.agentService) {
      return '- Agent service unavailable';
    }
    const agents = this.agentService.listAgents().filter(agent => agent.enabled);
    if (agents.length === 0) {
      return '- No enabled agents available';
    }

    return agents
      .map(agent => {
        const stats = this.agentService!.getTaskStatsForAgent(agent.id);
        const responsibility = this.compactRoutingText(agent.responsibility, 180);
        const lane = agent.id === orchestratorId ? 'self' : 'candidate';
        return [
          `- ${agent.id} (${agent.name})`,
          `  kind=${agent.kind} lane=${lane} autopoll=${agent.autoPoll ? 'on' : 'off'}`,
          `  queue: queued=${stats.queued} running=${stats.running} done=${stats.done} failed=${stats.failed}`,
          `  responsibility: ${responsibility}`,
        ].join('\n');
      })
      .join('\n');
  }

  private buildOrchestratorRequestPayload(orchestrator: AgentProfile, userTask: string): string {
    const roster = this.buildOrchestratorAgentRosterSnapshot(orchestrator.id);
    return [
      '<system-instruction>',
      'ORCHESTRATOR PREFLIGHT (apply before acting on this user request):',
      '- Inspect the agent roster snapshot below first.',
      '- Pick the most adequate enabled specialist for the requested task.',
      '- Prefer existing specialist tabs/agents; do not spawn a new agent for every request.',
      '- If a specialist already has an implementation+commit role, delegate the full task there and monitor completion.',
      '- If no agent is adequate, create or retask one before delegation.',
      '- Keep this tab orchestration-only (no direct implementation).',
      '',
      'Agent roster snapshot:',
      roster,
      '</system-instruction>',
      '',
      userTask,
    ].join('\n');
  }

  private collectRoutingContext(fromAgent: AgentProfile | null): string[] {
    if (!this.grokClient || !fromAgent) return [];
    const history = this.grokClient.getHistoryForSession(fromAgent.sessionId);
    const lines: string[] = [];
    for (let i = history.length - 1; i >= 0 && lines.length < 8; i -= 1) {
      const msg = history[i];
      if (!msg || msg.role === 'system' || msg.role === 'tool') continue;
      const raw = this.toTextContent(msg.content, msg.role).trim();
      if (!raw) continue;
      if (msg.role === 'user' && this.isInternalUserMessage(raw)) continue;
      if (msg.role === 'assistant' && this.isInternalAssistantMessage(raw)) continue;
      lines.push(`${msg.role}: ${this.compactRoutingText(raw, 220)}`);
    }
    return lines.reverse();
  }

  private buildRoutingPrompt(
    request: AgentRoutingRequest,
    fromAgent: AgentProfile | null,
    recentContext: string[],
  ): string {
    const agentsBlock = request.agents
      .map(agent => {
        const responsibility = this.compactRoutingText(agent.responsibility, 220);
        return `- id=${agent.id}; name=${agent.name}; kind=${agent.kind}; responsibility=${responsibility}`;
      })
      .join('\n');

    const contextBlock =
      recentContext.length > 0 ? recentContext.map(line => `- ${line}`).join('\n') : '- none';

    return [
      'You are a routing engine for delegated software tasks.',
      'Choose the best target agent to execute the task autonomously.',
      '',
      'Output requirements:',
      '- Return STRICT JSON only (no markdown, no prose, no code fences).',
      '- Use this schema exactly:',
      '{"toAgentId":"agent-id","rationale":"short reason","confidence":0.0,"taskBrief":"one-sentence executable brief"}',
      '',
      'Routing rules:',
      '- Choose one agent from the provided list.',
      '- Prefer the agent most likely to execute investigation/fix/verification directly.',
      '- Do not route based on a single keyword; use agent responsibility + recent sender context.',
      '- If requested target is already best, keep it.',
      '- If uncertain, still choose one and lower confidence.',
      '',
      `From agent: ${fromAgent ? `${fromAgent.id} (${fromAgent.name})` : request.fromAgentId}`,
      `Requested target: ${request.requestedToAgentId}`,
      `Task title: ${this.compactRoutingText(request.title, 180)}`,
      `Task details: ${this.compactRoutingText(request.content, 900)}`,
      '',
      'Available agents:',
      agentsBlock || '- none',
      '',
      'Recent sender context:',
      contextBlock,
    ].join('\n');
  }

  private extractFirstJsonObject(raw: string): string | null {
    const text = raw.trim();
    if (!text) return null;
    const candidates: string[] = [text];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      candidates.unshift(fenced[1].trim());
    }

    for (const candidate of candidates) {
      const direct = candidate.trim();
      if (direct.startsWith('{') && direct.endsWith('}')) {
        return direct;
      }

      let start = -1;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = 0; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) {
          continue;
        }
        if (ch === '{') {
          if (start < 0) start = i;
          depth += 1;
          continue;
        }
        if (ch === '}') {
          if (depth === 0) continue;
          depth -= 1;
          if (depth === 0 && start >= 0) {
            return candidate.slice(start, i + 1);
          }
        }
      }
    }
    return null;
  }

  private parseRoutingDecision(
    rawResponse: string,
    request: AgentRoutingRequest,
  ): AgentRoutingDecision | null {
    const normalized = cleanXmlTags(rawResponse).trim();
    if (!normalized) return null;
    const jsonPayload = this.extractFirstJsonObject(normalized);
    if (!jsonPayload) return null;

    try {
      const parsed = JSON.parse(jsonPayload) as Partial<AgentRoutingDecision>;
      if (typeof parsed.toAgentId !== 'string' || !parsed.toAgentId.trim()) {
        return null;
      }
      const candidate = parsed.toAgentId.trim();
      const candidateKey = candidate.toLowerCase();
      const knownAgent = request.agents.some(
        agent =>
          agent.id.toLowerCase() === candidateKey || agent.name.toLowerCase() === candidateKey,
      );
      if (!knownAgent) {
        return null;
      }
      const confidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : undefined;
      const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
      const taskBrief = typeof parsed.taskBrief === 'string' ? parsed.taskBrief.trim() : '';
      return {
        toAgentId: candidate,
        rationale: rationale || undefined,
        confidence,
        taskBrief: taskBrief || undefined,
      };
    } catch {
      return null;
    }
  }

  private async routeTaskWithLLM(
    request: AgentRoutingRequest,
  ): Promise<AgentRoutingDecision | null> {
    if (!this.grokClient) return null;
    const fromAgent = this.agentService?.getAgent(request.fromAgentId) || null;
    const recentContext = this.collectRoutingContext(fromAgent);
    const prompt = this.buildRoutingPrompt(request, fromAgent, recentContext);

    try {
      const { response } = await this.grokClient.chatIsolated(prompt, {
        quiet: true,
        includeFileContext: false,
        continueActions: false,
        executeActions: false,
        maxIterations: 1,
      });
      return this.parseRoutingDecision(response, request);
    } catch {
      return null;
    }
  }

  private toTextContent(content: any, role?: string): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join(' ');
    }
    return '[non-text content]';
  }

  private renderAssistantToolTranscript(text: string, tabId?: string): boolean {
    if (!this.tuiApp) return false;
    return display.withOutputTab(tabId, () => display.renderAssistantTranscript(text));
  }

  private resolveRenderMetadata(
    msg: any,
    raw: string,
  ): {
    kind:
      | 'skip'
      | 'user'
      | 'assistant_markdown'
      | 'assistant_tool_transcript'
      | 'compaction_divider'
      | 'tool'
      | 'plain';
    text: string;
  } {
    const finalize = (
      baseKind:
        | 'skip'
        | 'user'
        | 'assistant_markdown'
        | 'assistant_tool_transcript'
        | 'compaction_divider'
        | 'tool'
        | 'plain',
      baseText: string,
    ) => {
      const hookPayload = this.pluginRegistry.applyKernelHooks('render:before', {
        message: msg,
        role: String(msg?.role || ''),
        raw,
        kind: baseKind,
        text: baseText,
        skip: false,
      });
      let kind = baseKind;
      let text = baseText;
      const hookKind = hookPayload.kind;
      if (
        hookKind === 'skip' ||
        hookKind === 'user' ||
        hookKind === 'assistant_markdown' ||
        hookKind === 'assistant_tool_transcript' ||
        hookKind === 'compaction_divider' ||
        hookKind === 'tool' ||
        hookKind === 'plain'
      ) {
        kind = hookKind;
      }
      if (typeof hookPayload.text === 'string') {
        text = hookPayload.text;
      }
      if (hookPayload.skip === true) {
        kind = 'skip';
        text = '';
      }
      msg._render = { kind, text };
      return { kind, text };
    };

    const existing = msg?._render as { kind?: string; text?: string } | undefined;
    if (existing?.kind && typeof existing.text === 'string') {
      if (msg?.role === 'user') {
        const userText = this.extractRenderableUserMessage(raw);
        if (!userText) {
          return finalize('skip', '');
        }
        if (this.isInternalUserMessage(userText)) {
          return finalize('skip', '');
        }
        if (userText.includes('<session-summary>')) {
          return finalize('compaction_divider', 'Conversation context compacted');
        }
        return finalize('user', userText);
      }

      if (existing.kind === 'user') {
        const userText = this.extractRenderableUserMessage(existing.text || raw);
        if (this.isInternalUserMessage(userText)) {
          return finalize('skip', '');
        }
        return finalize('user', userText);
      }

      if (
        existing.kind === 'assistant_markdown' ||
        existing.kind === 'assistant_tool_transcript' ||
        existing.kind === 'plain'
      ) {
        const cleaned = this.cleanAssistantRenderableText(existing.text || raw);
        if (!cleaned || this.isInternalAssistantMessage(cleaned)) {
          return finalize('skip', '');
        }
        const kind = isAssistantToolTranscript(cleaned)
          ? 'assistant_tool_transcript'
          : 'assistant_markdown';
        return finalize(kind, cleaned);
      }

      const normalizedText = existing.text.trim();
      return finalize(
        existing.kind as
          | 'skip'
          | 'user'
          | 'assistant_markdown'
          | 'assistant_tool_transcript'
          | 'compaction_divider'
          | 'tool'
          | 'plain',
        normalizedText,
      );
    }

    let kind:
      | 'skip'
      | 'user'
      | 'assistant_markdown'
      | 'assistant_tool_transcript'
      | 'compaction_divider'
      | 'tool'
      | 'plain' = 'plain';
    let text = raw;

    if (msg?.role === 'user') {
      const normalizedUserText = this.extractRenderableUserMessage(raw);
      if (!normalizedUserText) {
        kind = 'skip';
      } else if (this.isInternalUserMessage(normalizedUserText)) {
        kind = 'skip';
      } else if (normalizedUserText.includes('<session-summary>')) {
        kind = 'compaction_divider';
        text = 'Conversation context compacted';
      } else {
        kind = 'user';
        text = normalizedUserText;
      }
    } else if (msg?.role === 'assistant') {
      const cleaned = this.cleanAssistantRenderableText(raw);
      text = cleaned;
      if (!cleaned) {
        kind = 'skip';
      } else if (this.isInternalAssistantMessage(cleaned)) {
        kind = 'skip';
      } else if (isAssistantToolTranscript(cleaned)) {
        kind = 'assistant_tool_transcript';
      } else {
        kind = 'assistant_markdown';
      }
    } else if (msg?.role === 'tool') {
      kind = 'tool';
    } else if (msg?.role === 'system') {
      kind = 'skip';
    }

    return finalize(kind, text);
  }

  private renderToolMessage(msg: any, options?: { tabId?: string }): void {
    if (!this.tuiApp) return;
    const tabId = options?.tabId;
    const toolResults = Array.isArray(msg?.toolResults) ? msg.toolResults : [];
    const isControlTool = (name: string): boolean => {
      const normalized = name.trim().toLowerCase();
      return (
        normalized === 'say_message' || normalized === 'end_task' || normalized === 'continue_task'
      );
    };

    if (toolResults.length > 0) {
      for (const item of toolResults) {
        const rawToolName = String(item?.toolName || 'tool');
        if (isControlTool(rawToolName)) continue;
        const toolName = humanizeToolName(rawToolName);
        const rawResult = String(item?.result || 'completed');
        const summary = summarizeToolResult(rawResult);
        if (isExploreToolName(rawToolName)) {
          if (summary.success ?? true) {
            display.pushExploreProbe(toolName, rawResult, true, undefined, tabId);
            continue;
          }
        }
        this.tuiApp.appendAssistantChat(
          formatToolAction(toolName, summary.detail, {
            success: summary.success ?? true,
          }),
          tabId,
        );
      }
      return;
    }

    const fallback = parseLegacyToolLine(this.toTextContent(msg?.content));
    if (isControlTool(fallback.toolName)) return;
    const toolName = humanizeToolName(fallback.toolName);
    const summary = summarizeToolResult(fallback.result);
    if (isExploreToolName(fallback.toolName)) {
      if (summary.success ?? true) {
        display.pushExploreProbe(toolName, fallback.result, true, undefined, tabId);
        return;
      }
    }
    this.tuiApp.appendAssistantChat(
      formatToolAction(toolName, summary.detail, {
        success: summary.success ?? true,
      }),
      tabId,
    );
  }

  private renderAgentHistoryMessage(
    msg: any,
    options?: { includeUser?: boolean; tabId?: string },
  ): boolean {
    if (!this.tuiApp) return false;
    const includeUser = options?.includeUser ?? true;
    const tabId = options?.tabId;
    const raw = this.toTextContent(msg.content, msg.role).trim();
    if (!raw) return false;
    const render = this.resolveRenderMetadata(msg, raw);
    const finalize = (rendered: boolean): boolean => {
      this.pluginRegistry.applyKernelHooks('render:after', {
        message: msg,
        role: String(msg?.role || ''),
        raw,
        kind: render.kind,
        text: render.text,
        rendered,
      });
      return rendered;
    };
    if (render.kind === 'skip') return finalize(false);

    if (render.kind === 'assistant_tool_transcript') {
      return finalize(this.renderAssistantToolTranscript(render.text, tabId));
    }
    if (render.kind === 'compaction_divider') {
      this.tuiApp.appendAssistantChat(
        formatToolAction('Compaction', 'conversation context', {
          success: true,
          summary: 'summary inserted',
        }),
        tabId,
      );
      return finalize(true);
    }
    if (render.kind === 'assistant_markdown') {
      this.tuiApp.appendAssistantMarkdown(render.text, tabId);
      return finalize(true);
    }
    if (render.kind === 'user') {
      if (!includeUser) return finalize(false);
      this.tuiApp.appendUserChat(render.text, tabId);
      return finalize(true);
    }
    if (render.kind === 'tool') {
      this.renderToolMessage(msg, { tabId });
      return finalize(true);
    }

    this.tuiApp.appendStyledChat(`[${msg.role}] ${render.text}`, tabId);
    return finalize(true);
  }

  private parseConnectorSessionId(sessionId: string): { source: string; targetId: string } | null {
    if (!this.isConnectorSessionId(sessionId)) {
      return null;
    }
    const idx = sessionId.indexOf(':');
    if (idx <= 0 || idx >= sessionId.length - 1) {
      return null;
    }
    return {
      source: sessionId.slice(0, idx),
      targetId: sessionId.slice(idx + 1),
    };
  }

  private renderConnectorSession(tabId: string): void {
    if (!this.tuiApp || !this.grokClient) {
      return;
    }
    const mapped = this.getConnectorTabInfo(tabId);
    const parsed = this.parseConnectorSessionId(tabId);
    const source = mapped?.source || parsed?.source;
    const targetId = mapped?.targetId || parsed?.targetId;
    const sessionId = mapped?.sessionId || (this.isConnectorSessionId(tabId) ? tabId : '');

    if (!source || !targetId || !sessionId) {
      this.tuiApp.clearChat();
      this.tuiApp.appendAssistantChat(`Unknown connector tab: ${tabId}`);
      return;
    }

    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
    this.tuiApp.clearChat();
    this.tuiApp.appendAssistantChat(
      `${sourceLabel} chat ${targetId}\nPinned connector conversation tab`,
    );

    const history = this.grokClient.getHistoryForSession(sessionId);
    const historyWithoutSystem = history.filter(msg => msg.role !== 'system');
    for (const msg of historyWithoutSystem.slice(-40)) {
      this.renderAgentHistoryMessage(msg, { includeUser: true, tabId });
    }
  }

  private renderTabSession(tabId: string): void {
    if (!this.tuiApp || !this.grokClient) return;

    if (tabId === 'agents') {
      this.renderAgentsManagerTab();
      return;
    }

    const agent = this.agentService?.getAgent(tabId);
    if (agent) {
      this.tuiApp.clearChat();
      this.tuiApp.appendAssistantChat(
        `Agent: ${agent.name} (${agent.id})\nRole: ${agent.responsibility}`,
      );
      const history = this.grokClient.getHistoryForSession(agent.sessionId);
      const historyWithoutSystem = history.filter(msg => msg.role !== 'system');
      for (const msg of historyWithoutSystem.slice(-40)) {
        this.renderAgentHistoryMessage(msg, { includeUser: true, tabId });
      }
      return;
    }

    if (this.getConnectorTabInfo(tabId) || this.isConnectorSessionId(tabId)) {
      this.renderConnectorSession(tabId);
      return;
    }

    if (tabId === 'main') {
      this.tuiApp.clearChat();
      const history = this.grokClient.getHistoryForSession('cli');
      const historyWithoutSystem = history.filter(msg => msg.role !== 'system');
      for (const msg of historyWithoutSystem.slice(-40)) {
        this.renderAgentHistoryMessage(msg, { includeUser: true, tabId });
      }
      return;
    }

    this.tuiApp.clearChat();
    this.tuiApp.appendAssistantChat(`Unknown tab: ${tabId}`);
  }

  private renderAgentsManagerTab(): void {
    if (!this.tuiApp || !this.agentService) return;
    this.tuiApp.clearChat();
    const summary = this.agentService.getSummary();
    const agents = this.agentService.listAgents();
    const now = new Date().toLocaleTimeString();

    this.tuiApp.appendAssistantChat(
      [
        `Agents Manager  ${now}`,
        `Active: ${summary.activeAgentId || 'none'}`,
        `Global queue: ${summary.queued} queued, ${summary.running} running, ${summary.done} done, ${summary.failed} failed`,
      ].join('\n'),
    );

    this.tuiApp.appendAssistantChat(
      [
        'Live controls:',
        '- New (create)',
        '- Edit (rename/role/prompt/poll/enable/disable/delete for selected tab)',
        '- Delete (remove selected tab agent)',
        '- /agent send <to-agent> <task>',
      ].join('\n'),
    );

    const lines: string[] = [];
    for (const agent of agents) {
      const active = agent.id === summary.activeAgentId ? '*' : ' ';
      const poll = agent.autoPoll ? 'on' : 'off';
      const enabled = agent.enabled ? 'on' : 'off';
      const lastRun = agent.lastRunAt ? agent.lastRunAt : 'never';
      const stats = this.agentService.getTaskStatsForAgent(agent.id);
      lines.push(`[${active}] ${agent.name} (${agent.id})`);
      lines.push(`role: ${agent.responsibility}`);
      lines.push(
        `status: enabled=${enabled} poll=${poll} | queue=${stats.queued} running=${stats.running} done=${stats.done} failed=${stats.failed} | lastRun=${lastRun}`,
      );
      if (agent.lastError) {
        lines.push(`lastError: ${agent.lastError}`);
      }
      lines.push('');
    }
    const roster = lines.join('\n').trim();
    this.tuiApp.appendAssistantChat(
      roster ? `Agents\n${roster}` : 'Agents\nNo agents yet. Use New to create one.',
    );
  }

  private notifyAgentTab(agentId: string): void {
    if (!agentId || !this.tuiApp) return;
    const activeTab = this.getCliActiveTabId();
    if (activeTab === agentId) {
      this.renderTabSession(agentId);
    } else {
      this.bumpTabUnread(agentId, 1);
    }
  }

  private startAgentsManagerRealtime(): void {
    if (this.agentsManagerRefreshTimer) return;
    this.agentsManagerRefreshTimer = setInterval(() => {
      if (this.getCliActiveTabId() === 'agents') {
        this.renderAgentsManagerTab();
      }
    }, 1500);
  }

  private stopAgentsManagerRealtime(): void {
    if (!this.agentsManagerRefreshTimer) return;
    clearInterval(this.agentsManagerRefreshTimer);
    this.agentsManagerRefreshTimer = null;
  }

  private async editAgentInteractive(agentId: string): Promise<void> {
    if (!this.tuiApp || !this.agentService) return;
    const agent = this.agentService.getAgent(agentId);
    if (!agent) {
      display.warningText(`Agent not found: ${agentId}`);
      return;
    }

    if (agent.removable === false) {
      display.warningText('This agent is protected and cannot be deleted.');
      return;
    }

    const action = (
      await this.tuiApp.promptInput('Edit action [name|role|prompt|autopoll|enable|disable|delete]')
    )
      .trim()
      .toLowerCase();
    if (!action) return;

    if (action === 'name') {
      const next = (await this.tuiApp.promptInput('New name', { initialValue: agent.name })).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { name: next });
      this.refreshAgentTabs();
      this.renderTabSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'role') {
      const next = (
        await this.tuiApp.promptInput('New responsibility', { initialValue: agent.responsibility })
      ).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { responsibility: next });
      this.renderTabSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'prompt') {
      const next = (
        await this.tuiApp.promptInput('New system prompt', {
          initialValue: agent.systemPrompt || '',
        })
      ).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { systemPrompt: next });
      this.renderTabSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'autopoll') {
      const mode = (await this.tuiApp.promptInput('autopoll [on|off]')).trim().toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        display.warningText('Autopoll mode must be "on" or "off".');
        return;
      }
      await this.agentService.updateAgent(agent.id, { autoPoll: mode === 'on' });
      this.renderTabSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'enable' || action === 'disable') {
      await this.agentService.updateAgent(agent.id, { enabled: action === 'enable' });
      this.renderTabSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'delete') {
      await this.deleteAgentInteractive(agent.id);
      return;
    }

    display.warningText(`Unknown edit action: ${action}`);
  }

  private async deleteAgentInteractive(agentId: string): Promise<void> {
    if (!this.tuiApp || !this.agentService) return;
    const agent = this.agentService.getAgent(agentId);
    if (!agent) {
      display.warningText(`Agent not found: ${agentId}`);
      return;
    }

    const ok = await this.agentService.deleteAgent(agent.id);
    if (!ok) {
      display.warningText('Delete failed (agent not found).');
      return;
    }
    this.unreadByTab.delete(agent.id);
    this.refreshAgentTabs();
    await this.switchTab('agents');
  }

  private buildAgentTabs(): TabItem[] {
    if (!this.agentService) {
      return [
        {
          id: 'main',
          label: 'Main',
          section: 'agents',
          editable: false,
          removable: false,
        },
      ];
    }
    return buildAgentTabItems({
      agents: this.agentService.listAgents().map(agent => ({
        id: agent.id,
        name: agent.name,
        sessionId: agent.sessionId,
      })),
      spinnerFrames: this.SPINNER_FRAMES,
      spinnerFrameIndex: this.spinnerFrame,
      getUnreadCount: tabId => this.getUnreadCount(tabId),
      isReticulating: sessionId => this.isSessionReticulating(sessionId),
      isRemovableAgent: agentId => this.agentService?.getAgent(agentId)?.removable !== false,
    });
  }

  private buildConnectorTabs(): TabItem[] {
    this.connectorTabs.clear();
    const built = buildConnectorTabItems({
      snapshots: this.connectorRegistry.getSnapshots(),
      spinnerFrames: this.SPINNER_FRAMES,
      spinnerFrameIndex: this.spinnerFrame,
      getUnreadCount: tabId => this.getUnreadCount(tabId),
      isReticulating: sessionId => this.isSessionReticulating(sessionId),
    });
    for (const info of built.infos) {
      this.connectorTabs.set(info.tabId, info);
    }
    return built.tabs;
  }

  private resolveActiveTabId(tabs: TabItem[]): string {
    const active = this.getCliActiveTabId();
    if (tabs.some(tab => tab.id === active)) {
      return active;
    }
    const preferred = this.agentService?.getActiveAgentId();
    if (preferred && tabs.some(tab => tab.id === preferred)) {
      return preferred;
    }
    return tabs[0]?.id || 'agents';
  }

  private refreshAgentTabs(): void {
    if (!this.tuiApp) return;
    const previousActive = this.tuiApp.getActiveTabId();
    const baseTabs = [...this.buildAgentTabs(), ...this.buildConnectorTabs()];
    const baseActive = this.resolveActiveTabId(baseTabs);
    const beforeHook = this.pluginRegistry.applyKernelHooks('tabs:before', {
      tabs: baseTabs,
      activeTabId: baseActive,
    });
    const tabs = Array.isArray(beforeHook.tabs) ? (beforeHook.tabs as TabItem[]) : baseTabs;
    const candidateActive =
      typeof beforeHook.activeTabId === 'string' ? beforeHook.activeTabId : baseActive;
    const active = tabs.some(tab => tab.id === candidateActive)
      ? candidateActive
      : this.resolveActiveTabId(tabs);
    const validTabIds = new Set(tabs.map(tab => tab.id));
    for (const tabId of Array.from(this.unreadByTab.keys())) {
      if (!validTabIds.has(tabId)) {
        this.unreadByTab.delete(tabId);
      }
    }
    this.tuiApp.updateTabs(tabs, active);
    this.syncInputAvailabilityForTab(active);
    if (active !== previousActive) {
      if (!this.tuiApp.hasTabHistory(active)) {
        this.renderTabSession(active);
      }
      if (active === 'agents') {
        this.startAgentsManagerRealtime();
      } else {
        this.stopAgentsManagerRealtime();
      }
      this.syncActiveTabReticulatingIndicator();
    }
    this.pluginRegistry.applyKernelHooks('tabs:after', {
      tabs,
      activeTabId: active,
      previousActiveTabId: previousActive,
    });
  }

  private async switchTab(tabId: string): Promise<void> {
    if (!this.tuiApp) return;

    const isAgentsTab = tabId === 'agents';
    const agent = this.agentService?.getAgent(tabId) || null;
    const isConnectorTab = !!this.getConnectorTabInfo(tabId) || this.isConnectorSessionId(tabId);
    const isMainTab = tabId === 'main';

    if (agent) {
      const ok = await this.agentService?.setActiveAgent(tabId);
      if (!ok) {
        return;
      }
      await this.ensureAgentSession(agent);
    } else if (!isAgentsTab && !isConnectorTab && !isMainTab) {
      return;
    }

    this.clearTabUnread(tabId, { refresh: false });
    this.tuiApp.setActiveTab(tabId);
    this.refreshAgentTabs();
    const activeTabId = this.getCliActiveTabId();
    if (!this.tuiApp.hasTabHistory(activeTabId)) {
      this.renderTabSession(activeTabId);
    }
    this.syncActiveTabReticulatingIndicator();
    if (activeTabId === 'agents') {
      this.startAgentsManagerRealtime();
    } else {
      this.stopAgentsManagerRealtime();
    }
  }

  private async createAgentInteractive(): Promise<void> {
    if (!this.tuiApp) return;
    if (!this.agentService) {
      display.warningText('Agent service is not available. Restart slashbot and try again.');
      return;
    }
    const name = (await this.tuiApp.promptInput('Agent name')).trim();
    if (!name) {
      return;
    }
    const responsibility = (await this.tuiApp.promptInput('Responsibility')).trim();
    const prompt = (await this.tuiApp.promptInput('System prompt (optional)')).trim();
    const created = await this.agentService.createAgent({
      name,
      responsibility: responsibility || undefined,
      systemPrompt: prompt || undefined,
    });
    await this.ensureAgentSession(created);
    await this.switchTab(created.id);
  }

  private async runDelegatedTask(
    agent: AgentProfile,
    taskText: string,
  ): Promise<{ response: string; endMessage?: string }> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }
    await this.ensureAgentSession(agent);
    this.beginReticulatingSession(agent.sessionId);
    try {
      const executionPolicy = this.isOrchestratorAgent(agent)
        ? 'orchestrator'
        : this.buildSpecialistExecutionPolicy();
      const result = await display.withOutputTab(agent.id, () =>
        this.grokClient!.chatWithResponse(taskText, undefined, 180000, agent.sessionId, {
          displayResult: false,
          quiet: true,
          outputTabId: agent.id,
          executionPolicy,
        }),
      );
      return result;
    } finally {
      this.endReticulatingSession(agent.sessionId);
    }
  }

  private async initializeGrok(): Promise<void> {
    const apiKey = this.configManager.getApiKey();
    if (apiKey) {
      try {
        // Load saved config
        const savedConfig = this.configManager.getConfig();
        this.grokClient = createGrokClient(apiKey, {
          provider: savedConfig.provider,
          model: savedConfig.model,
        });
        this.grokClient.setSessionRunCallbacks({
          onSessionRunStart: sessionId => this.beginReticulatingSession(sessionId),
          onSessionRunEnd: sessionId => this.endReticulatingSession(sessionId),
        });

        // Load all saved provider credentials into the registry
        const allCreds = this.configManager.getAllProviderCredentials();
        for (const [providerId, creds] of Object.entries(allCreds)) {
          if (creds?.apiKey) {
            this.grokClient.getProviderRegistry().configure(providerId, {
              apiKey: creds.apiKey,
              baseUrl: creds.baseUrl,
            });
          }
        }

        const savedProvider = savedConfig.provider;
        if (savedProvider) {
          const providerKey =
            this.configManager.getProviderCredentials(savedProvider)?.apiKey || apiKey;
          this.grokClient.setProvider(savedProvider, providerKey);
        }
        if (savedConfig.model) {
          this.grokClient.setModel(savedConfig.model);
        }

        // Load context file if exists (CLAUDE.md, GROK.md, or SLASHBOT.md)
        const workDir = this.codeEditor.getWorkDir();
        const contextFileNames = ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md'];
        let contextLoaded = false;

        for (const fileName of contextFileNames) {
          const contextFilePath = `${workDir}/${fileName}`;
          const contextFile = Bun.file(contextFilePath);

          if (await contextFile.exists()) {
            try {
              const contextContent = await contextFile.text();
              this.grokClient.setProjectContext(contextContent, workDir);
              this.loadedContextFile = fileName;
              contextLoaded = true;
              break;
            } catch {
              // Ignore read errors, try next file
            }
          }
        }

        if (!contextLoaded && (await this.codeEditor.isAuthorized())) {
          // Fallback: inject basic project context if authorized but no SLASHBOT.md
          const context = `Directory: ${workDir}`;
          this.grokClient.setProjectContext(context, workDir);
        }

        // Wire up action handlers from plugins
        const pluginActionContributions = this.pluginRegistry.getActionContributions();
        const pluginHandlers = buildHandlersFromContributions(pluginActionContributions);
        this.grokClient.setActionHandlers(pluginHandlers);

        // Wire PromptAssembler and ToolRegistry into GrokClient
        this.grokClient.setPromptAssembler(this.promptAssembler);
        this.grokClient.setToolRegistry(this.toolRegistry);
        await this.grokClient.buildAssembledPrompt();
      } catch {
        this.grokClient = null;
      }
    } else {
      this.grokClient = null;
    }
  }

  private async handleInput(
    input: string,
    source: ConnectorSource = 'cli',
    sessionId?: string,
  ): Promise<string | void> {
    let hookInput = '';
    let hookHandled = false;
    let hookResponse: string | void = undefined;
    let hookError: string | null = null;

    try {
      // Expand any paste placeholders back to original content (CLI only)
      let expanded = source === 'cli' ? await expandPaste(input) : input;

      // Save expanded input (before persistent paste prepend) for history
      if (source === 'cli') {
        this.lastExpandedInput = expanded;
      }

      // Persistent paste: if no paste placeholder was in the input but lastPaste exists, prepend it
      if (
        source === 'cli' &&
        !input.match(/\[pasted content \d+ lines?\]/) &&
        !input.match(/\[pasted:\d+:[^\]]+\]/)
      ) {
        const lastPaste = getLastPaste();
        if (lastPaste) {
          expanded = lastPaste.content + '\n' + expanded;
        }
      }

      const rawTrimmed = expanded.trim();
      const beforeHook = await this.pluginRegistry.applyKernelHooksAsync('input:before', {
        input: rawTrimmed,
        source,
        sessionId,
        handled: false,
        response: undefined,
      });
      hookInput = typeof beforeHook.input === 'string' ? beforeHook.input.trim() : rawTrimmed;
      if (beforeHook.handled === true) {
        hookHandled = true;
        hookResponse = typeof beforeHook.response === 'string' ? beforeHook.response : undefined;
        return hookResponse;
      }
      if (!hookInput) {
        hookHandled = true;
        return;
      }
      const trimmed = hookInput;

      // Handle ? shortcut for help
      if (trimmed === '?') {
        const parsed = await parseInput('/help');
        await executeCommand(parsed, this.getContext());
        return;
      }

      // Strip @botname suffix from Telegram/Discord commands (e.g. /clear@mybot → /clear)
      const cleaned = trimmed.replace(/^(\/\w+)@\S+/, '$1');

      const parsed = await parseInput(cleaned);

      // Handle slash commands
      if (parsed.isCommand) {
        const result = await executeCommand(parsed, this.getContext());
        await this.pluginRegistry.applyKernelHooksAsync('input:after-command', {
          source,
          sessionId,
          command: parsed.command,
          args: parsed.args,
          rawArgs: parsed.rawArgs,
          result,
          refreshTabs: () => this.refreshAgentTabs(),
          getActiveTabId: () => this.getCliActiveTabId(),
          renderAgentsManagerTab: () => this.renderAgentsManagerTab(),
          renderTabSession: (tabId: string) => this.renderTabSession(tabId),
          hasAgentTab: (tabId: string) => !!this.agentService?.getAgent(tabId),
          hasConnectorTab: (tabId: string) => !!this.getConnectorTabInfo(tabId),
          switchTab: (tabId: string) => this.switchTab(tabId),
          getActiveAgentId: () => this.agentService?.getActiveAgentId() || null,
        });
        // For connectors, return a confirmation so they don't say "No response generated"
        if (source !== 'cli') {
          hookResponse = result ? `Done: /${parsed.command}` : `/${parsed.command}`;
          return hookResponse;
        }
        return;
      }

      // Hard guard: NEVER send slash-prefixed input to LLM, even if parseInput didn't flag it
      if (cleaned.startsWith('/')) {
        const cmd = cleaned.split(/\s+/)[0];
        if (source !== 'cli') {
          hookResponse = `Unknown command: ${cmd}`;
          return hookResponse;
        }
        display.errorText(`Unknown command: ${cmd}`);
        display.muted('Use /help to see available commands');
        return;
      }

      // In connector tabs, plain CLI input is treated as outbound platform message.
      if (source === 'cli') {
        const activeTabId = this.getCliActiveTabId();
        const connectorTab = this.resolveConnectorTabInfo(activeTabId);
        if (connectorTab) {
          const outcome = await this.connectorRegistry.notify(
            trimmed,
            connectorTab.source,
            connectorTab.targetId,
          );
          if (outcome.sent.includes(connectorTab.source)) {
            this.tuiApp?.logConnectorOut(connectorTab.source, trimmed);
            hookHandled = true;
            return;
          }

          const runtime = this.connectorRegistry.get(connectorTab.source);
          const sourceLabel =
            connectorTab.source.charAt(0).toUpperCase() + connectorTab.source.slice(1);
          const status = runtime?.getStatus?.();
          const errorMsg = !runtime || !status?.configured
            ? `${sourceLabel} connector is not configured`
            : !runtime.isRunning()
              ? `${sourceLabel} connector is not running`
              : `Failed to send message to ${sourceLabel} ${connectorTab.targetId}. Ensure this chat started the bot and is authorized.`;
          this.tuiApp?.appendAssistantChat(errorMsg, connectorTab.sessionId);
          hookHandled = true;
          hookError = errorMsg;
          return;
        }
      }

      // Handle natural language - send to Grok
      if (!this.grokClient) {
        const msg = 'Not connected to Grok. Use /login to enter your API key.';
        if (source !== 'cli') {
          hookResponse = msg;
          return hookResponse;
        }
        display.warningText('Not connected to Grok');
        display.muted('  Use /login to enter your API key');
        return;
      }

      let cliTargetSessionId: string | null = null;
      let cliOriginTabId: string | null = null;
      let cliHistoryStart = -1;
      let cliRequestSessionId: string | null = null;
      let cliAgent: AgentProfile | null = null;
      let startedUserTurn = false;
      let cliReticulating = false;
      let cliExecutionPolicy:
        | 'orchestrator'
        | {
            blockedToolNames: string[];
            blockedActionTypes: string[];
            blockReason: string;
          }
        | undefined;
      let cliIsOrchestrator = false;

      if (source === 'cli') {
        const activeTab = this.getCliActiveTabId();
        if (activeTab === 'agents') {
          display.warningText(
            'Agents manager tab does not run prompts. Switch to an agent tab first.',
          );
          return;
        }
        cliOriginTabId = activeTab;
        cliTargetSessionId = this.getSessionIdForTab(activeTab) || 'cli';
        cliAgent = this.getAgentForTab(activeTab);
        if (cliAgent) {
          await this.ensureAgentSession(cliAgent);
          if (this.isOrchestratorAgent(cliAgent)) {
            cliExecutionPolicy = 'orchestrator';
            cliIsOrchestrator = true;
          } else {
            cliExecutionPolicy = this.buildSpecialistExecutionPolicy();
          }
        }
        cliHistoryStart = this.grokClient.getHistoryForSession(cliTargetSessionId).length;
        this.grokClient.setSession(cliTargetSessionId);
      }
      const uiTabId = source === 'cli' ? cliOriginTabId || this.getCliActiveTabId() : undefined;

      try {
        // For external connectors (Telegram, Discord), collect the response
        if (source !== 'cli') {
          const effectiveConnectorSessionId = sessionId || source;
          await this.ensureConnectorSession(source, effectiveConnectorSessionId);
          const connectorTabId =
            sessionId && this.isConnectorSessionId(sessionId) ? sessionId : undefined;
          const shouldPreferWebSearch =
            (source === 'telegram' || source === 'discord') &&
            this.shouldPreferWebSearchForConnectorQuery(trimmed);
          const blockedToolNames = [`${source}_send`];
          const blockedActionTypes = [`${source}-send`];
          let connectorBlockReason =
            `Do not call ${source} send tools while handling an inbound ${source} message. ` +
            'Return plain response text instead.';
          if (shouldPreferWebSearch) {
            blockedToolNames.push('bash', 'exec');
            blockedActionTypes.push('bash', 'exec');
            connectorBlockReason =
              'This looks like an external web lookup. Use `search` (web_search/x_search) and optionally `fetch`; do not use bash/curl.';
          }
          const connectorExecutionPolicy =
            source === 'telegram' || source === 'discord'
              ? {
                  blockedToolNames,
                  blockedActionTypes,
                  blockReason: connectorBlockReason,
                }
              : undefined;
          if (connectorTabId) {
            this.tuiApp?.appendUserChat(trimmed, connectorTabId);
          }
          const { response } = await this.grokClient.chatWithResponse(
            trimmed,
            source,
            120000, // timeout
            effectiveConnectorSessionId, // channel/chat-specific session
            {
              quiet: true,
              displayResult: false,
              outputTabId: connectorTabId,
              executionPolicy: connectorExecutionPolicy,
            },
          );
          if (connectorTabId && response.trim()) {
            this.tuiApp?.appendAssistantMarkdown(response, connectorTabId);
            if (this.getCliActiveTabId() !== connectorTabId) {
              this.bumpTabUnread(connectorTabId, 1);
            }
          }
          await this.dumpContext();
          hookResponse = response;
          return hookResponse;
        }
        display.beginUserTurn(uiTabId);
        startedUserTurn = true;

        let llmUserMessage = trimmed;
        if (cliIsOrchestrator && cliAgent) {
          llmUserMessage = this.buildOrchestratorRequestPayload(cliAgent, trimmed);
        }

        // For CLI tabbed chat, pin to the originating session and keep output local.
        cliRequestSessionId = cliTargetSessionId || 'cli';
        this.activeCliRequestSessionId = cliRequestSessionId;
        this.beginReticulatingSession(cliRequestSessionId);
        cliReticulating = true;
        const chatResult = await display.withOutputTab(uiTabId, () =>
          this.grokClient!.chat(llmUserMessage, {
            sessionId: cliTargetSessionId || undefined,
            displayResult: false,
            quiet: true,
            outputTabId: uiTabId,
            executionPolicy: cliExecutionPolicy,
          }),
        );
        if (cliReticulating && cliRequestSessionId) {
          this.endReticulatingSession(cliRequestSessionId);
          cliReticulating = false;
        }
        if (source === 'cli' && cliOriginTabId && cliTargetSessionId) {
          const startIdx = Math.max(0, cliHistoryStart);
          let history = this.grokClient.getHistoryForSession(cliTargetSessionId);
          let newMessages = history.slice(startIdx);

          // If the model produced a non-empty response but no renderable replay items,
          // persist a deterministic assistant markdown fallback so switching tabs never
          // hides the completion.
          const addedFallback = this.ensureRenderableAssistantFallback(
            cliTargetSessionId,
            newMessages,
            chatResult.response,
          );
          if (addedFallback) {
            history = this.grokClient.getHistoryForSession(cliTargetSessionId);
            newMessages = history.slice(startIdx);
          }

          if (this.getCliActiveTabId() === cliOriginTabId) {
            let rendered = false;
            for (const msg of newMessages) {
              // User message is already shown instantly in input submit path.
              if (msg.role === 'user') continue;
              // Tool actions are already surfaced live while executing.
              if (msg.role === 'tool') continue;
              rendered =
                this.renderAgentHistoryMessage(msg, {
                  includeUser: false,
                  tabId: cliOriginTabId,
                }) || rendered;
            }
            if (!rendered && chatResult.response.trim()) {
              this.tuiApp?.appendAssistantMarkdown(chatResult.response);
            }
          } else {
            const renderableCount = this.countRenderableAgentMessages(newMessages);
            const unreadDelta = Math.max(1, renderableCount);
            this.bumpTabUnread(cliOriginTabId, unreadDelta);
            const targetAgent = this.getAgentForTab(cliOriginTabId);
            if (targetAgent) {
              display.showNotification(
                `${targetAgent.name}: ${unreadDelta} new message${unreadDelta > 1 ? 's' : ''}`,
              );
            } else {
              const connectorTab = this.getConnectorTabInfo(cliOriginTabId);
              if (connectorTab) {
                display.showNotification(
                  `${connectorTab.label}: ${unreadDelta} new message${unreadDelta > 1 ? 's' : ''}`,
                );
              }
            }
          }
        }
        await this.dumpContext();
      } catch (error) {
        // Don't show error for aborted requests
        if (error instanceof Error && error.name === 'AbortError') {
          if (source !== 'cli') {
            hookResponse = 'Error: request timed out. Please retry.';
            return hookResponse;
          }
          return;
        }
        // TokenModeError is already displayed in violet by the client
        if (error instanceof Error && error.name === 'TokenModeError') {
          if (source !== 'cli') {
            const tokenMsg = error.message?.trim() || 'Token mode is not available.';
            hookResponse = `Error: ${tokenMsg}`;
            return hookResponse;
          }
          return;
        }
        const errorMsg = this.formatLLMErrorMessage(error);
        hookError = errorMsg;
        if (source !== 'cli') {
          hookResponse = `Error: ${errorMsg}`;
          return hookResponse;
        }
        this.surfaceLLMErrorInChat(error, {
          sessionId: cliTargetSessionId || cliRequestSessionId || 'cli',
          tabId: uiTabId,
        });
      } finally {
        if (cliReticulating && cliRequestSessionId) {
          this.endReticulatingSession(cliRequestSessionId);
        }
        if (cliRequestSessionId && this.activeCliRequestSessionId === cliRequestSessionId) {
          this.activeCliRequestSessionId = null;
        }
        if (startedUserTurn) {
          display.endUserTurn(uiTabId);
        }
      }
    } catch (error) {
      hookError = this.formatLLMErrorMessage(error);
      throw error;
    } finally {
      await this.pluginRegistry.applyKernelHooksAsync('input:after', {
        input: hookInput,
        source,
        sessionId,
        handled: hookHandled,
        response: hookResponse,
        error: hookError,
      });
    }
  }

  private async loadHistory(): Promise<void> {
    this.history = await loadHistoryFromDisk();
  }

  private saveHistory(): void {
    // Debounce: only save after 2 seconds of no new inputs
    if (this.historySaveTimeout) {
      clearTimeout(this.historySaveTimeout);
    }
    this.historySaveTimeout = setTimeout(async () => {
      try {
        await writeHistoryToDisk(this.history);
      } catch {
        // Ignore save errors
      }
    }, 2000);
  }

  private async dumpContext(): Promise<void> {
    if (!this.grokClient) return;
    try {
      const sessionIds = this.grokClient.getSessionIds();
      const sessions = sessionIds
        .map(sessionId => ({
          sessionId,
          history: this.grokClient!.getHistoryForSession(sessionId),
        }))
        .filter(session => session.history.some(msg => msg.role !== 'system'));
      await writeContextDump(sessions, this.codeEditor.getWorkDir());
    } catch {
      // Silently ignore dump errors
    }
  }

  private toSidebarData(value: unknown): SidebarData | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const candidate = value as Partial<SidebarData>;
    if (typeof candidate.model !== 'string') {
      return null;
    }
    if (typeof candidate.provider !== 'string') {
      return null;
    }
    if (!Array.isArray(candidate.items)) {
      return null;
    }
    if (candidate.availableModels && !Array.isArray(candidate.availableModels)) {
      return null;
    }
    return candidate as SidebarData;
  }

  private buildSidebarDataWithHooks(): SidebarData {
    const baseSidebarData = buildBaseSidebarData({
      sidebarContributions: this.pluginRegistry.getSidebarContributions(),
      currentModelId: this.grokClient?.getCurrentModel(),
      availableModels: this.grokClient?.getAvailableModels() || [],
    });
    const beforeHook = this.pluginRegistry.applyKernelHooks('sidebar:before', {
      sidebarData: baseSidebarData,
    });
    const sidebarData = this.toSidebarData(beforeHook.sidebarData) || baseSidebarData;
    this.pluginRegistry.applyKernelHooks('sidebar:after', {
      sidebarData,
    });
    return sidebarData;
  }

  private refreshSidebar(): void {
    if (!this.tuiApp) return;
    const sidebarData = this.buildSidebarDataWithHooks();
    this.tuiApp.updateSidebar(sidebarData);
  }

  async startGateway(): Promise<void> {
    await this.initializeServices();
    await this.codeEditor.init();

    if (this.agentService) {
      this.agentService.stop();
      this.agentService.setWorkDir(this.codeEditor.getWorkDir());
      await this.agentService.init();
      await this.agentService.start();
    }

    await this.commandPermissions.load();
    await this.loadHistory();

    const pluginContext: PluginContext = createPluginRuntimeContext({
      container,
      eventBus: this.eventBus,
      configManager: this.configManager,
      workDir: this.codeEditor.getWorkDir(),
      getGrokClient: () => this.grokClient,
    });

    await this.pluginRegistry.callLifecycleHook('onBeforeGrokInit', pluginContext);
    await this.initializeGrok();
    await this.pluginRegistry.callLifecycleHook('onAfterGrokInit', pluginContext);

    await this.pluginRegistry.applyKernelHooksAsync('startup:after-grok-ready', {
      agentService: this.agentService,
      routeTaskWithLLM: (request: AgentRoutingRequest) => this.routeTaskWithLLM(request),
      runDelegatedTask: (agent: AgentProfile, taskText: string) =>
        this.runDelegatedTask(agent, taskText),
      isOrchestratorAgent: (agent: AgentProfile) => this.isOrchestratorAgent(agent),
    });

    const connectorPlugins = this.pluginRegistry.getByCategory('connector') as ConnectorPlugin[];
    await initializeConnectorPlugins({
      connectorPlugins,
      pluginContext,
      eventBus: this.eventBus,
      connectorRegistry: this.connectorRegistry,
      onMessage: async (message, source, metadata) =>
        this.handleInput(message, source, metadata?.sessionId),
      onError: (pluginName, error) => {
        display.warningText(`[${pluginName}] Could not start: ${error}`);
      },
    });

    if (this.agentService) {
      await this.syncConnectorAgents();
    }

    this.eventBus.on('connector:connected', () => {
      void this.syncConnectorAgents();
    });

    await this.pluginRegistry.applyKernelHooksAsync('startup:after-connectors-ready', {
      connectorRegistry: this.connectorRegistry,
    });

    this.running = true;
  }

  async start(): Promise<void> {
    // Initialize DI services first (also loads config before plugin init)
    await this.initializeServices();

    // Initialize code editor
    await this.codeEditor.init();

    // Initialize multi-agent workspace in the actual workdir
    if (this.agentService) {
      this.agentService.stop();
      this.agentService.setWorkDir(this.codeEditor.getWorkDir());
      await this.agentService.init();
      await this.agentService.start();
    }

    // Initialize command permissions
    await this.commandPermissions.load();

    // Load command history
    await this.loadHistory();

    // Plugin lifecycle: onBeforeGrokInit (e.g., wallet password prompting)
    const pluginContext: PluginContext = createPluginRuntimeContext({
      container,
      eventBus: this.eventBus,
      configManager: this.configManager,
      workDir: this.codeEditor.getWorkDir(),
      getGrokClient: () => this.grokClient,
    });
    await this.pluginRegistry.callLifecycleHook('onBeforeGrokInit', pluginContext);

    // Initialize Grok client if API key available
    await this.initializeGrok();

    // Plugin lifecycle: onAfterGrokInit (e.g., wallet ProxyAuthProvider wiring)
    await this.pluginRegistry.callLifecycleHook('onAfterGrokInit', pluginContext);

    await this.pluginRegistry.applyKernelHooksAsync('startup:after-grok-ready', {
      agentService: this.agentService,
      routeTaskWithLLM: (request: AgentRoutingRequest) => this.routeTaskWithLLM(request),
      runDelegatedTask: (agent: AgentProfile, taskText: string) =>
        this.runDelegatedTask(agent, taskText),
      isOrchestratorAgent: (agent: AgentProfile) => this.isOrchestratorAgent(agent),
    });

    // Check for updates in background (non-blocking, once per 24h)
    import('../app/updater').then(({ startupUpdateCheck }) => startupUpdateCheck()).catch(() => {});
    // Initialize connectors from plugins
    const connectorPlugins = this.pluginRegistry.getByCategory('connector') as ConnectorPlugin[];
    await initializeConnectorPlugins({
      connectorPlugins,
      pluginContext,
      eventBus: this.eventBus,
      connectorRegistry: this.connectorRegistry,
      onIncoming: (connectorName, message) => {
        this.tuiApp?.logConnectorIn(connectorName, message);
      },
      onOutgoing: (connectorName, response) => {
        this.tuiApp?.logConnectorOut(connectorName, response);
      },
      onMessage: async (message, source, metadata) =>
        this.handleInput(message, source, metadata?.sessionId),
      onError: (pluginName, error) => {
        display.warningText(`[${pluginName}] Could not start: ${error}`);
      },
    });

    if (this.agentService) {
      await this.syncConnectorAgents();
    }

    this.eventBus.on('connector:connected', () => {
      void this.syncConnectorAgents();
    });

    await this.pluginRegistry.applyKernelHooksAsync('startup:after-connectors-ready', {
      connectorRegistry: this.connectorRegistry,
    });

    const workDir = this.codeEditor.getWorkDir();
    const rebuildSidebar = () => {
      this.refreshSidebar();
      this.refreshAgentTabs();
    };

    // Create and initialize TUI
    const VERSION = this.version;
    const tuiApp = new TUIApp(
      {
        onInput: async (input: string) => {
          await this.handleInput(input);
          // Save expanded content to history (not raw placeholder text)
          const expandedTrimmed = (this.lastExpandedInput || input).trim();
          if (expandedTrimmed && expandedTrimmed !== this.history[this.history.length - 1]) {
            this.history.push(expandedTrimmed);
            this.saveHistory();
          }
          // Also update InputPanel's history for up/down arrow navigation
          if (this.tuiApp && expandedTrimmed) {
            this.tuiApp.pushInputHistory(expandedTrimmed);
          }
          rebuildSidebar();
          this.syncInputAvailabilityForTab(this.getCliActiveTabId());
        },
        onTabChange: async (tabId: string) => {
          await this.switchTab(tabId);
        },
        onCreateAgent: async () => {
          await this.createAgentInteractive();
        },
        onEditAgent: async (agentId: string) => {
          await this.editAgentInteractive(agentId);
        },
        onDeleteAgent: async (agentId: string) => {
          await this.deleteAgentInteractive(agentId);
        },
        onExit: async () => {
          await this.stop();
          process.exit(0);
        },
        onAbort: options => this.abortJobsInTab(options),
      },
      {
        completer,
        history: this.history,
      },
    );

    await tuiApp.init();
    this.tuiApp = tuiApp;

    // Render header
    tuiApp.setHeader({
      version: VERSION,
      workingDir: workDir,
    });

    // Set initial sidebar
    this.refreshSidebar();

    this.refreshAgentTabs();
    if (this.agentService) {
      const activeAgentId = this.agentService.getActiveAgentId() || 'agent-architect';
      await this.switchTab(activeAgentId);
    } else {
      await this.switchTab('main');
    }

    await this.pluginRegistry.applyKernelHooksAsync('startup:after-ui-ready', {
      eventBus: this.eventBus,
      tuiApp: this.tuiApp,
      refreshSidebar: () => this.refreshSidebar(),
      refreshTabs: () => this.refreshAgentTabs(),
      refreshLayout: () => rebuildSidebar(),
      getActiveTabId: () => this.getCliActiveTabId(),
      getSessionIdForTab: (tabId: string) => this.getSessionIdForTab(tabId),
      normalizeSpinnerLabel: (label: string | undefined) => this.normalizeSpinnerLabel(label),
      isSessionReticulating: (sessionId: string) => this.isSessionReticulating(sessionId),
      setReticulatingLabel: (sessionId: string, label: string) =>
        this.setReticulatingLabel(sessionId, label),
      syncActiveTabReticulatingIndicator: () => this.syncActiveTabReticulatingIndicator(),
      getGrokClient: () => this.grokClient,
      renderAgentsManagerTab: () => this.renderAgentsManagerTab(),
      notifyAgentTab: (agentId: string) => this.notifyAgentTab(agentId),
      handleAgentTaskFailed: (event: any) => this.handleAgentTaskFailed(event || {}),
    });

    // Focus input - TUI handles the rest via callbacks
    tuiApp.focusInput();
    this.running = true;
  }

  /**
   * Run in non-interactive mode - process a message and exit, or just show banner
   */
  async runNonInteractive(message?: string): Promise<void> {
    // Initialize DI services (also loads config before plugin init)
    await this.initializeServices();
    await this.codeEditor.init();
    await this.commandPermissions.load();

    const preflight = await this.pluginRegistry.applyKernelHooksAsync('run:noninteractive:before', {
      message: message || '',
      blocked: false,
      exitCode: 1,
      reason: '',
      hint: '',
    });
    if (preflight.blocked === true) {
      const reason =
        typeof preflight.reason === 'string' && preflight.reason.trim()
          ? preflight.reason
          : 'Non-interactive execution blocked by a plugin preflight check.';
      display.errorText(reason);
      if (typeof preflight.hint === 'string' && preflight.hint.trim()) {
        display.muted(preflight.hint);
      }
      const exitCode =
        typeof preflight.exitCode === 'number' && Number.isFinite(preflight.exitCode)
          ? preflight.exitCode
          : 1;
      process.exit(exitCode);
    }

    // Initialize Grok client
    await this.initializeGrok();
    await this.pluginRegistry.callLifecycleHook(
      'onAfterGrokInit',
      createPluginRuntimeContext({
        container,
        eventBus: this.eventBus,
        configManager: this.configManager,
        workDir: this.codeEditor.getWorkDir(),
        getGrokClient: () => this.grokClient,
      }),
    );
    await this.pluginRegistry.applyKernelHooksAsync('startup:after-grok-ready', {
      agentService: this.agentService,
      routeTaskWithLLM: (request: AgentRoutingRequest) => this.routeTaskWithLLM(request),
      runDelegatedTask: (agent: AgentProfile, taskText: string) =>
        this.runDelegatedTask(agent, taskText),
      isOrchestratorAgent: (agent: AgentProfile) => this.isOrchestratorAgent(agent),
    });

    // If no message, just exit
    if (!message) {
      display.muted('(Non-interactive mode - no message provided)');
      return;
    }

    // Check if it's a slash command — never send to LLM
    const trimmed = message.trim();
    if (trimmed.startsWith('/')) {
      const parsed = await parseInput(trimmed);
      if (parsed.isCommand) {
        await executeCommand(parsed, this.getContext());
      } else {
        display.errorText(`Unknown command: ${trimmed.split(/\s+/)[0]}`);
        display.muted('Use /help to see available commands');
      }
      return;
    }

    // Process the message with Grok
    if (!this.grokClient) {
      display.errorText('Not connected to Grok. Use `slashbot login <api_key>` first.');
      process.exit(1);
    }

    try {
      // Send message and stream response to console
      await this.grokClient.chat(message);
      display.newline();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      display.errorText(`Error: ${errorMsg}`);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    await this.pluginRegistry.applyKernelHooksAsync('shutdown:before', {
      reason: 'stop',
    });

    // Stop all connectors
    this.connectorRegistry.stopAll();
    this.stopAgentsManagerRealtime();

    // Destroy all plugins
    if (this.pluginRegistry) {
      await this.pluginRegistry.destroyAll();
    }
    // Flush history immediately on stop
    if (this.historySaveTimeout) {
      clearTimeout(this.historySaveTimeout);
    }
    try {
      await writeHistoryToDisk(this.history);
    } catch {
      // Ignore save errors
    }
    // Clear TUI callbacks and destroy TUI app (restores terminal state)
    setTUISpinnerCallbacks(null);
    display.setThinkingCallback(null);
    this.reticulatingBySession.clear();
    this.reticulatingLabelBySession.clear();
    this.activeReticulatingSessionId = null;
    this.activeReticulatingLabel = null;
    if (this.tuiApp) {
      this.tuiApp.destroy();
      this.tuiApp = null;
    }
  }
}
