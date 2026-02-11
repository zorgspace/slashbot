/**
 * Slashbot Kernel - Core orchestrator class
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  display,
  formatToolAction,
  parseLegacyToolLine,
  summarizeToolResult,
  humanizeToolName,
  isAssistantToolTranscript,
  type SidebarData,
} from '../ui';
import { createGrokClient, GrokClient } from '../api';
import { PROVIDERS, MODELS, inferProvider } from '../../plugins/providers/models';
import { parseInput, executeCommand, CommandContext, completer } from '../commands/parser';
import { addImage, imageBuffer } from '../../plugins/filesystem/services/ImageBuffer';
import type { ConnectorSource, Connector } from '../../connectors/base';
import { walletExists, isSessionActive } from '../../plugins/wallet/services';
import { setTUISpinnerCallbacks } from '../ui';
import { TUIApp } from '../../plugins/tui/TUIApp';
import type { TabItem } from '../../plugins/tui/panels/TabsPanel';
import { expandPaste, getLastPaste, getLastPasteSummary } from '../../plugins/tui/pasteHandler';
import { getLocalSlashbotDir, getLocalHistoryFile } from '../config/constants';

// DI imports
import { initializeContainer, getService, TYPES, container } from '../di/container';
import type { ConfigManager } from '../config/config';
import type { CodeEditor } from '../../plugins/code-editor/services/CodeEditor';
import type { CommandPermissions } from '../../plugins/system/services/CommandPermissions';
import type { SecureFileSystem } from '../../plugins/filesystem/services/SecureFileSystem';
import type { ConnectorRegistry } from '../../connectors/registry';
import type { EventBus } from '../events/EventBus';
import type { AgentOrchestratorService, AgentProfile } from '../../plugins/agents/services';

// Plugin system imports
import { PluginRegistry } from '../../plugins/registry';
import { loadAllPlugins } from '../../plugins/loader';
import { PromptAssembler } from '../api/prompts/assembler';
import { ToolRegistry } from '../api/toolRegistry';
import { buildHandlersFromContributions, buildExecutorMap } from '../../plugins/utils';
import { setDynamicExecutorMap } from '../actions/executor';
import type { ConnectorPlugin } from '../../plugins/types';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';

export interface SlashbotConfig {
  basePath?: string;
}

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
  private running = false;
  private history: string[] = [];
  private loadedContextFile: string | null = null;
  private historySaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private basePath?: string;
  private promptRedrawUnsubscribe: (() => void) | null = null;
  private tuiApp: TUIApp | null = null;
  private agentService: AgentOrchestratorService | null = null;
  private agentsManagerRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeCliRequestSessionId: string | null = null;
  private lastExpandedInput = '';
  private version = '';

  constructor(config: SlashbotConfig = {}) {
    this.basePath = config.basePath;
  }

  setVersion(version: string): void {
    this.version = version;
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
    this.pluginRegistry.setContext({
      container,
      eventBus: this.eventBus,
      configManager: this.configManager,
      workDir: process.cwd(),
      getGrokClient: () => this.grokClient,
    });
    await this.pluginRegistry.initAll();

    // Resolve plugin-registered services (bound during plugin init)
    this.codeEditor = getService<CodeEditor>(TYPES.CodeEditor);
    this.commandPermissions = getService<CommandPermissions>(TYPES.CommandPermissions);
    this.fileSystem = getService<SecureFileSystem>(TYPES.FileSystem);
    if (container.isBound(TYPES.AgentOrchestratorService)) {
      this.agentService = getService<AgentOrchestratorService>(TYPES.AgentOrchestratorService);
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
    return this.tuiApp?.getActiveTabId() || this.agentService?.getActiveAgentId() || 'agent-1';
  }

  private abortJobsInTab(options?: { tabId?: string; source?: 'ctrl_c' | 'escape' }): boolean {
    const source = options?.source || 'ctrl_c';
    const tabId = options?.tabId || this.getCliActiveTabId();
    const agent = this.getAgentForTab(tabId);
    const targetSessionId = agent?.sessionId || 'cli';
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
          .abandonJobsForAgent(
            agent.id,
            `Aborted via ${source.toUpperCase()} in tab ${tabId}`,
          )
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

  private async ensureAgentSession(agent: AgentProfile): Promise<void> {
    if (!this.grokClient) return;
    const marker = `agent-profile:${agent.id}:v3`;
    const history = this.grokClient.getHistoryForSession(agent.sessionId);
    const hasProfile = history.some(
      msg =>
        msg.role === 'system' && typeof msg.content === 'string' && msg.content.includes(marker),
    );
    if (!hasProfile) {
      this.grokClient.addMessageToSession(agent.sessionId, {
        role: 'system',
        content: [
          `<!-- ${marker} -->`,
          agent.systemPrompt,
          'Coordination tools you should use first: agents_status, agents_send, sessions_list, sessions_history, sessions_send.',
          'Do NOT use bash/ls/glob/read_file to inspect .agents or route tasks between agents.',
          'Use say_message for progress; use end_task only when the delegated task is complete.',
          `Workspace: ${agent.workspaceDir}`,
          `AgentDir: ${agent.agentDir}`,
        ].join('\n'),
      });
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

  private renderAssistantToolTranscript(text: string): boolean {
    if (!this.tuiApp) return false;
    return display.renderAssistantTranscript(text);
  }

  private isExploreTool(toolName: string): boolean {
    const normalized = toolName.trim().toLowerCase();
    return (
      normalized === 'grep' ||
      normalized === 'ls' ||
      normalized === 'list' ||
      normalized === 'glob' ||
      normalized === 'explore' ||
      normalized === 'read' ||
      normalized === 'read_file'
    );
  }

  private buildExplorePreview(raw: string, maxLines = 5): { lines: string[]; total: number } {
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^\[[✓✗]\]\s*/, ''));
    return {
      lines: lines.slice(0, maxLines),
      total: lines.length,
    };
  }

  private buildExploreSummaryMarkdown(
    entries: Array<{ toolName: string; success: boolean; lines: string[]; total: number }>,
  ): string {
    const total = entries.reduce((sum, e) => sum + e.total, 0);
    const ok = entries.every(e => e.success);
    const allPreviewRows = entries.flatMap(entry => entry.lines.map(line => `- ${entry.toolName}: ${line}`));
    const previewRows = allPreviewRows.slice(-5);
    const hidden = Math.max(0, total - previewRows.length);
    const header = `Explore - ${entries.length} probe(s) ${ok ? '✓' : '✗'} ${total} lines`;
    if (previewRows.length === 0) {
      return `${header}\n- no matches`;
    }
    return `${header}\n${previewRows.join('\n')}${hidden > 0 ? `\n- ... +${hidden} more line(s)` : ''}`;
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
    const existing = msg?._render as { kind?: string; text?: string } | undefined;
    if (existing?.kind && typeof existing.text === 'string') {
      const normalizedText =
        existing.kind === 'user' ? existing.text.replace(/^\[you\]\s*/i, '') : existing.text;
      if (normalizedText !== existing.text) {
        msg._render = { kind: existing.kind, text: normalizedText };
      }
      return {
        kind: existing.kind as
          | 'skip'
          | 'user'
          | 'assistant_markdown'
          | 'assistant_tool_transcript'
          | 'compaction_divider'
          | 'tool'
          | 'plain',
        text: normalizedText,
      };
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
      if (
        raw.includes('<system-instruction>')
      ) {
        kind = 'skip';
      } else if (raw.includes('<session-summary>')) {
        kind = 'compaction_divider';
        text = 'Conversation context compacted';
      } else {
        kind = 'user';
        text = raw.replace(/^\[you\]\s*/i, '');
      }
    } else if (msg?.role === 'assistant') {
      const cleaned = cleanSelfDialogue(cleanXmlTags(raw))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      text = cleaned;
      if (!cleaned) {
        kind = 'skip';
      } else if (cleaned.includes('<session-actions>') || cleaned.includes('[ralph-nudge]')) {
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

    msg._render = { kind, text };
    return { kind, text };
  }

  private renderToolMessage(msg: any): void {
    if (!this.tuiApp) return;
    const toolResults = Array.isArray(msg?.toolResults) ? msg.toolResults : [];
    const isControlTool = (name: string): boolean => {
      const normalized = name.trim().toLowerCase();
      return normalized === 'say_message' || normalized === 'end_task' || normalized === 'continue_task';
    };

    if (toolResults.length > 0) {
      const regular: any[] = [];
      const explore: Array<{
        toolName: string;
        success: boolean;
        lines: string[];
        total: number;
      }> = [];

      for (const item of toolResults) {
        const rawToolName = String(item?.toolName || 'tool');
        if (isControlTool(rawToolName)) continue;
        const toolName = humanizeToolName(rawToolName);
        const summary = summarizeToolResult(String(item?.result || 'completed'));
        if (this.isExploreTool(rawToolName)) {
          const preview = this.buildExplorePreview(String(item?.result || ''));
          explore.push({
            toolName,
            success: summary.success ?? true,
            lines: preview.lines,
            total: preview.total,
          });
          continue;
        }
        regular.push(item);
      }

      for (const item of regular) {
        const toolName = humanizeToolName(String(item?.toolName || 'tool'));
        const summary = summarizeToolResult(String(item?.result || 'completed'));
        this.tuiApp.appendAssistantChat(
          formatToolAction(toolName, summary.detail, {
            success: summary.success ?? true,
          }),
        );
      }

      if (explore.length > 0) {
        this.tuiApp.appendAssistantMarkdown(this.buildExploreSummaryMarkdown(explore));
      }
      return;
    }

    const fallback = parseLegacyToolLine(this.toTextContent(msg?.content));
    if (isControlTool(fallback.toolName)) return;
    const toolName = humanizeToolName(fallback.toolName);
    const summary = summarizeToolResult(fallback.result);
    if (this.isExploreTool(fallback.toolName)) {
      const preview = this.buildExplorePreview(fallback.result);
      this.tuiApp.appendAssistantMarkdown(
        this.buildExploreSummaryMarkdown([
          {
            toolName,
            success: summary.success ?? true,
            lines: preview.lines,
            total: preview.total,
          },
        ]),
      );
      return;
    }
    this.tuiApp.appendAssistantChat(
      formatToolAction(toolName, summary.detail, {
        success: summary.success ?? true,
      }),
    );
  }

  private renderAgentHistoryMessage(msg: any, options?: { includeUser?: boolean }): boolean {
    if (!this.tuiApp) return false;
    const includeUser = options?.includeUser ?? true;
    const raw = this.toTextContent(msg.content, msg.role).trim();
    if (!raw) return false;
    const render = this.resolveRenderMetadata(msg, raw);
    if (render.kind === 'skip') return false;

    if (render.kind === 'assistant_tool_transcript') {
      return this.renderAssistantToolTranscript(render.text);
    }
    if (render.kind === 'compaction_divider') {
      this.tuiApp.appendAssistantChat(
        formatToolAction('Compaction', 'conversation context', {
          success: true,
          summary: 'summary inserted',
        }),
      );
      return true;
    }
    if (render.kind === 'assistant_markdown') {
      this.tuiApp.appendAssistantMarkdown(render.text);
      return true;
    }
    if (render.kind === 'user') {
      if (!includeUser) return false;
      this.tuiApp.appendUserChat(render.text);
      return true;
    }
    if (render.kind === 'tool') {
      this.renderToolMessage(msg);
      return true;
    }

    this.tuiApp.appendStyledChat(`[${msg.role}] ${render.text}`);
    return true;
  }

  private renderAgentSession(tabId: string): void {
    if (!this.tuiApp || !this.grokClient || !this.agentService) return;

    if (tabId === 'agents') {
      this.renderAgentsManagerTab();
      return;
    }

    const agent = this.agentService.getAgent(tabId);
    if (!agent) {
      this.tuiApp.clearChat();
      this.tuiApp.appendAssistantChat(`Unknown agent tab: ${tabId}`);
      return;
    }

    this.tuiApp.clearChat();
    this.tuiApp.appendAssistantChat(
      `Agent: ${agent.name} (${agent.id})\nRole: ${agent.responsibility}`,
    );
    const history = this.grokClient.getHistoryForSession(agent.sessionId);
    const historyWithoutSystem = history.filter(msg => msg.role !== 'system');
    for (const msg of historyWithoutSystem.slice(-40)) {
      this.renderAgentHistoryMessage(msg, { includeUser: true });
    }
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
        `Active: ${summary.activeAgentId}`,
        `Global queue: ${summary.queued} queued, ${summary.running} running, ${summary.done} done, ${summary.failed} failed`,
      ].join('\n'),
    );

    this.tuiApp.appendAssistantChat(
      [
        'Live controls:',
        '- + New Agent (create)',
        '- Edit Agent (rename/role/prompt/poll/enable/delete for selected tab)',
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
    this.tuiApp.appendAssistantChat(`Agents\n${lines.join('\n').trim()}`);
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

    const action = (
      await this.tuiApp.promptInput('Edit action [name|role|prompt|autopoll|enable|disable|delete]')
    )
      .trim()
      .toLowerCase();
    if (!action) return;

    if (action === 'name') {
      const next = (await this.tuiApp.promptInput('New name')).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { name: next });
      this.refreshAgentTabs();
      this.renderAgentSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'role') {
      const next = (await this.tuiApp.promptInput('New responsibility')).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { responsibility: next });
      this.renderAgentSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'prompt') {
      const next = (await this.tuiApp.promptInput('New system prompt')).trim();
      if (!next) return;
      await this.agentService.updateAgent(agent.id, { systemPrompt: next });
      this.renderAgentSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'autopoll') {
      const mode = (await this.tuiApp.promptInput('autopoll [on|off]')).trim().toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        display.warningText('Autopoll mode must be "on" or "off".');
        return;
      }
      await this.agentService.updateAgent(agent.id, { autoPoll: mode === 'on' });
      this.renderAgentSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'enable' || action === 'disable') {
      await this.agentService.updateAgent(agent.id, { enabled: action === 'enable' });
      this.renderAgentSession(this.getCliActiveTabId());
      return;
    }

    if (action === 'delete') {
      const confirm = (
        await this.tuiApp.promptInput(`Type "${agent.id}" to confirm delete`)
      ).trim();
      if (confirm !== agent.id) {
        display.warningText('Delete cancelled.');
        return;
      }
      const ok = await this.agentService.deleteAgent(agent.id);
      if (!ok) {
        display.warningText('Delete failed (cannot remove last agent).');
        return;
      }
      this.refreshAgentTabs();
      await this.switchTab(this.agentService.getActiveAgentId());
      return;
    }

    display.warningText(`Unknown edit action: ${action}`);
  }

  private refreshAgentTabs(): void {
    if (!this.tuiApp || !this.agentService) return;
    const tabs: TabItem[] = [{ id: 'agents', label: 'Agents' }];
    for (const agent of this.agentService.listAgents()) {
      tabs.push({ id: agent.id, label: agent.name });
    }
    const active = this.getCliActiveTabId();
    this.tuiApp.updateTabs(tabs, active);
  }

  private async switchTab(tabId: string): Promise<void> {
    if (!this.agentService || !this.tuiApp) return;
    if (tabId !== 'agents') {
      const ok = await this.agentService.setActiveAgent(tabId);
      if (!ok) {
        return;
      }
      const agent = this.agentService.getAgent(tabId);
      if (agent) {
        await this.ensureAgentSession(agent);
      }
    }
    this.tuiApp.setActiveTab(tabId);
    this.refreshAgentTabs();
    this.renderAgentSession(tabId);
    if (tabId === 'agents') {
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

  private async runDelegatedTask(agent: AgentProfile, taskText: string): Promise<string> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }
    await this.ensureAgentSession(agent);
    const response = await this.grokClient.chatWithResponse(
      taskText,
      undefined,
      180000,
      agent.sessionId,
      { displayResult: false },
    );
    return response;
  }

  private async initializeGrok(): Promise<void> {
    const apiKey = this.configManager.getApiKey();
    if (apiKey) {
      try {
        // Load saved config
        const savedConfig = this.configManager.getConfig();
        this.grokClient = createGrokClient(apiKey, savedConfig);

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

    const trimmed = expanded.trim();

    if (!trimmed) return;

    // Handle ? shortcut for help
    if (trimmed === '?') {
      const parsed = await parseInput('/help');
      await executeCommand(parsed, this.getContext());
      return;
    }

    // Handle pasted images directly into buffer (CLI only)
    if (source === 'cli') {
      // Check for base64 data URL
      const imageMatch = trimmed.match(/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/i);
      if (imageMatch) {
        addImage(trimmed);
        display.successText(`🖼️  Image added to context #${imageBuffer.length}`);
        return;
      }

      // Check for image file path (supports ~, absolute and relative paths)
      const pathMatch = trimmed.match(/^['"]?([~\/]?[^\s'"]+\.(png|jpg|jpeg|gif|webp|bmp))['"]?$/i);
      if (pathMatch) {
        try {
          let filePath = pathMatch[1];
          // Expand ~ to home directory
          if (filePath.startsWith('~')) {
            filePath = filePath.replace('~', process.env.HOME || '');
          }
          // Make relative paths absolute
          if (!filePath.startsWith('/')) {
            filePath = `${process.cwd()}/${filePath}`;
          }

          const fs = await import('fs');
          if (fs.existsSync(filePath)) {
            const imageData = fs.readFileSync(filePath);
            const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
            const mimeTypes: Record<string, string> = {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              gif: 'image/gif',
              webp: 'image/webp',
              bmp: 'image/bmp',
            };
            const mimeType = mimeTypes[ext] || 'image/png';
            const base64 = imageData.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64}`;
            addImage(dataUrl);
            display.appendAssistantMessage(
              formatToolAction('Image', filePath.split('/').pop() || 'file', {
                success: true,
                summary: `${Math.round(base64.length / 1024)}KB`,
              }),
            );
            return;
          }
        } catch (err) {
          // Not a valid image file, continue processing as normal input
        }
      }
    }

    // Strip @botname suffix from Telegram/Discord commands (e.g. /clear@mybot → /clear)
    const cleaned = trimmed.replace(/^(\/\w+)@\S+/, '$1');

    const parsed = await parseInput(cleaned);

    // Handle slash commands
    if (parsed.isCommand) {
      const result = await executeCommand(parsed, this.getContext());
      if (source === 'cli' && (parsed.command === 'agent' || parsed.command === 'agents')) {
        if (this.agentService) {
          const currentTab = this.getCliActiveTabId();
          this.refreshAgentTabs();
          if (currentTab === 'agents') {
            this.renderAgentsManagerTab();
          } else if (this.agentService.getAgent(currentTab)) {
            this.renderAgentSession(currentTab);
          } else {
            await this.switchTab(this.agentService.getActiveAgentId());
          }
        }
      }
      // For connectors, return a confirmation so they don't say "No response generated"
      if (source !== 'cli') {
        return result ? `Done: /${parsed.command}` : `/${parsed.command}`;
      }
      return;
    }

    // Hard guard: NEVER send slash-prefixed input to LLM, even if parseInput didn't flag it
    if (cleaned.startsWith('/')) {
      const cmd = cleaned.split(/\s+/)[0];
      if (source !== 'cli') return `Unknown command: ${cmd}`;
      display.errorText(`Unknown command: ${cmd}`);
      display.muted('Use /help to see available commands');
      return;
    }

    // Handle natural language - send to Grok
    if (!this.grokClient) {
      const msg = 'Not connected to Grok. Use /login to enter your API key.';
      if (source !== 'cli') return msg;
      display.warningText('Not connected to Grok');
      display.muted('  Use /login to enter your API key');
      return;
    }

    let cliTargetSessionId: string | null = null;
    let cliOriginTabId: string | null = null;
    let cliHistoryStart = -1;
    let cliRequestSessionId: string | null = null;
    let startedUserTurn = false;

    if (source === 'cli') {
      const activeTab = this.getCliActiveTabId();
      if (activeTab === 'agents') {
        display.warningText(
          'Agents manager tab does not run prompts. Switch to an agent tab first.',
        );
        return;
      }
      const cliAgent = this.getAgentForTab(activeTab) || this.agentService?.getActiveAgent();
      if (cliAgent) {
        await this.ensureAgentSession(cliAgent);
        cliOriginTabId = activeTab;
        cliTargetSessionId = cliAgent.sessionId;
        cliHistoryStart = this.grokClient.getHistoryForSession(cliAgent.sessionId).length;
        this.grokClient.setSession(cliAgent.sessionId);
      }
    }

    try {
      // For external connectors (Telegram, Discord), collect the response
      if (source !== 'cli') {
        const response = await this.grokClient.chatWithResponse(
          trimmed,
          source as 'telegram' | 'discord',
          120000, // timeout
          sessionId, // channel/chat-specific session
        );
        return response;
      }
      display.beginUserTurn();
      startedUserTurn = true;

      // Check for planning trigger (CLI only)
      const planningPlugin = this.pluginRegistry.get('feature.planning') as
        | import('../../plugins/planning').PlanningPlugin
        | undefined;
      if (planningPlugin && !planningPlugin.isActive() && planningPlugin.detectTrigger(trimmed)) {
        await this.runPlanningFlow(trimmed, planningPlugin);
        return;
      }

      // For CLI tabbed chat, pin to the originating session and keep output local.
      cliRequestSessionId = cliTargetSessionId || 'cli';
      this.activeCliRequestSessionId = cliRequestSessionId;
      display.startThinking('Reticulating...');
      const chatResult = await this.grokClient.chat(trimmed, {
        sessionId: cliTargetSessionId || undefined,
        displayResult: false,
        quiet: true,
      });
      display.stopThinking();
      if (
        source === 'cli' &&
        cliOriginTabId &&
        cliTargetSessionId &&
        this.getCliActiveTabId() === cliOriginTabId
      ) {
        const history = this.grokClient.getHistoryForSession(cliTargetSessionId);
        const startIdx = Math.max(0, cliHistoryStart);
        const newMessages = history.slice(startIdx);
        let rendered = false;
        for (const msg of newMessages) {
          // User message is already shown instantly in input submit path.
          if (msg.role === 'user') continue;
          // Tool actions are already rendered live by executors; skip replay to avoid duplicates.
          if (msg.role === 'tool') continue;
          rendered = this.renderAgentHistoryMessage(msg, { includeUser: false }) || rendered;
        }
        if (!rendered && chatResult.response.trim()) {
          this.tuiApp?.appendAssistantMarkdown(chatResult.response);
        }
      }
      await this.dumpContext();
    } catch (error) {
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        display.hideSpinner();
        return;
      }
      // TokenModeError is already displayed in violet by the client
      if (error instanceof Error && error.name === 'TokenModeError') {
        display.hideSpinner();
        return;
      }
      display.hideSpinner();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (source !== 'cli') return `Error: ${errorMsg}`;
      display.errorBlock(errorMsg);
    } finally {
      if (cliRequestSessionId && this.activeCliRequestSessionId === cliRequestSessionId) {
        this.activeCliRequestSessionId = null;
      }
      if (startedUserTurn) {
        display.endUserTurn();
      }
    }
  }

  /**
   * Two-phase planning flow:
   * Phase 1: LLM explores codebase and creates a plan file
   * Phase 2: Flush context, inject plan, execute with clean context
   */
  private async runPlanningFlow(
    userMessage: string,
    planningPlugin: import('../../plugins/planning').PlanningPlugin,
  ): Promise<void> {
    display.violet('Planning mode activated');
    display.muted('Phase 1: Exploring codebase and creating plan...');

    // Subscribe to plan:ready event to capture plan path
    let planPath: string | null = null;
    const unsub = this.eventBus.on('plan:ready', e => {
      planPath = e.planPath;
    });

    try {
      // Phase 1: Planning — LLM explores and creates plan file
      planningPlugin.setMode('planning');
      await this.grokClient!.buildAssembledPrompt();
      await this.grokClient!.chat(userMessage);

      // Retry: force plan file creation if the LLM answered conversationally
      if (!planPath) {
        display.muted('No plan file yet — forcing plan file creation...');
        await this.grokClient!.chat(
          'You did NOT produce a plan file. You MUST create the plan file now using <write path=".slashbot/plans/plan-<slug>.md"> with the structured format, then signal with <plan-ready path="..."/>. Do NOT explain — just write the file.',
        );
      }

      unsub();

      if (!planPath) {
        display.warningText('Planning phase did not produce a plan file');
        planningPlugin.setMode('idle');
        await this.grokClient!.buildAssembledPrompt();
        return;
      }

      const planFileExists = await Bun.file(
        path.resolve(this.codeEditor.getWorkDir(), planPath),
      ).exists();
      if (!planFileExists) {
        display.warningText('Plan file not found on disk right now: ' + planPath);
        display.muted('Continuing anyway using the plan path (no immediate read-back).');
      }

      // Phase 2: Execution — flush context, inject plan, execute
      display.violet('Phase 2: Executing plan with clean context...');
      display.muted('Plan: ' + planPath);

      this.grokClient!.clearHistory();
      planningPlugin.setMode('executing');
      await this.grokClient!.buildAssembledPrompt();

      await this.grokClient!.chat(
        [
          `Execute the implementation plan at: ${planPath}`,
          '',
          'Do not ask me to restate the plan.',
          `Read "${planPath}" yourself first, then execute it step by step.`,
        ].join('\n'),
      );

      await this.dumpContext();
    } catch (error) {
      unsub();
      if (error instanceof Error && error.name === 'AbortError') {
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        display.errorBlock(errorMsg);
      }
    } finally {
      // Always reset to idle
      planningPlugin.setMode('idle');
      await this.grokClient!.buildAssembledPrompt();

      // Archive plan file instead of deleting
      if (planPath) {
        try {
          const fullPlanPath = path.resolve(this.codeEditor.getWorkDir(), planPath);
          const archiveDir = path.join(this.codeEditor.getWorkDir(), '.slashbot', 'plans');
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.copyFileSync(fullPlanPath, path.join(archiveDir, path.basename(planPath)));
          fs.unlinkSync(fullPlanPath);
          display.muted('Plan archived to .slashbot/plans/' + path.basename(planPath));
        } catch {
          // Ignore if already deleted or inaccessible
        }
      }
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);
      if (await file.exists()) {
        const content = await file.text();
        this.history = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            // JSON-encoded lines (new format) vs plain text (old format)
            try {
              const parsed = JSON.parse(line);
              return typeof parsed === 'string' ? parsed : line;
            } catch {
              return line;
            }
          });
      }
    } catch {
      // No history file yet
    }
  }

  private saveHistory(): void {
    // Debounce: only save after 2 seconds of no new inputs
    if (this.historySaveTimeout) {
      clearTimeout(this.historySaveTimeout);
    }
    this.historySaveTimeout = setTimeout(async () => {
      try {
        const { mkdir } = await import('fs/promises');
        const configDir = getLocalSlashbotDir();
        await mkdir(configDir, { recursive: true });

        // Keep last 500 commands, JSON-encode each to preserve newlines
        const historyToSave = this.history.slice(-500);
        await Bun.write(
          getLocalHistoryFile(),
          historyToSave.map(h => JSON.stringify(h)).join('\n'),
        );
      } catch {
        // Ignore save errors
      }
    }, 2000);
  }

  private async dumpContext(): Promise<void> {
    if (!this.grokClient) return;
    try {
      const history = this.grokClient.getHistory();
      if (history.length <= 1) return; // Only system prompt, no conversation

      const contextDir = path.join(getLocalSlashbotDir(this.codeEditor.getWorkDir()), 'context');

      // Create directory if it doesn't exist
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }

      // Generate filename with datetime
      const now = new Date();
      const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = path.join(contextDir, `${datetime}.md`);

      // Format as markdown
      let markdown = `# Conversation - ${now.toLocaleString()}\n\n`;
      for (const msg of history) {
        const role =
          msg.role === 'user' ? '## User' : msg.role === 'assistant' ? '## Assistant' : '## System';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        markdown += `${role}\n\n${content}\n\n---\n\n`;
      }

      await Bun.write(filename, markdown);
    } catch {
      // Silently ignore dump errors
    }
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
    const pluginContext = {
      container,
      eventBus: this.eventBus,
      configManager: this.configManager,
      workDir: this.codeEditor.getWorkDir(),
      getGrokClient: () => this.grokClient,
    };
    await this.pluginRegistry.callLifecycleHook('onBeforeGrokInit', pluginContext);

    // Initialize Grok client if API key available
    await this.initializeGrok();

    // Plugin lifecycle: onAfterGrokInit (e.g., wallet ProxyAuthProvider wiring)
    await this.pluginRegistry.callLifecycleHook('onAfterGrokInit', pluginContext);

    if (this.agentService) {
      this.agentService.setTaskExecutor(async (agent, task) => {
        const taskPrompt = [
          `You are executing delegated task ${task.id}.`,
          `Title: ${task.title}`,
          `From: ${task.fromAgentId}`,
          'Task details:',
          task.content,
          '',
          'Action policy:',
          '- Use orchestration tools first for coordination: agents_status, agents_send, sessions_list, sessions_history, sessions_send.',
          '- Do NOT use bash/ls/glob/read_file for orchestration or to inspect .agents state.',
          '- Use say_message for concise progress updates.',
          'When complete, summarize what was done and any remaining blockers in 3-6 bullet points.',
        ].join('\n');
        const summary = await this.runDelegatedTask(agent, taskPrompt);
        return { summary: summary.slice(0, 2000) };
      });
    }

    // Subscribe to prompt:redraw so plugins (e.g. MCP) can trigger prompt rebuild
    this.promptRedrawUnsubscribe = this.eventBus.on('prompt:redraw', async () => {
      await this.grokClient?.buildAssembledPrompt();
    });

    this.eventBus.on('agents:updated', () => {
      this.refreshAgentTabs();
      if (this.getCliActiveTabId() === 'agents') {
        this.renderAgentsManagerTab();
      }
    });

    // Check for updates in background (non-blocking, once per 24h)
    import('../app/updater').then(({ startupUpdateCheck }) => startupUpdateCheck()).catch(() => {});
    // Initialize connectors from plugins
    const connectorPlugins = this.pluginRegistry.getByCategory('connector') as ConnectorPlugin[];
    for (const plugin of connectorPlugins) {
      if (!plugin.createConnector) continue;
      try {
        const pluginContext = {
          container,
          eventBus: this.eventBus,
          configManager: this.configManager,
          workDir: this.codeEditor.getWorkDir(),
          getGrokClient: () => this.grokClient,
        };
        const connector = (await plugin.createConnector(pluginContext)) as Connector | null;
        if (!connector) continue;

        const connectorName = plugin.metadata.id.replace('connector.', '') as ConnectorSource;
        connector.setEventBus?.(this.eventBus);
        connector.setMessageHandler(
          async (message: string, source: ConnectorSource, metadata?: any) => {
            // Log incoming connector message to comm panel
            this.tuiApp?.logConnectorIn(connectorName as string, message);

            const response = await this.handleInput(message, source, metadata?.sessionId);

            // Log outgoing response to comm panel
            if (response) {
              this.tuiApp?.logConnectorOut(connectorName as string, response);
            }
            return response as string;
          },
        );
        await connector.start();
        this.connectorRegistry.register(connectorName, {
          connector,
          isRunning: () => connector.isRunning(),
          sendMessage: (msg: string) => connector.sendMessage(msg),
          sendMessageTo:
            'sendMessageTo' in connector
              ? (chatId: string, msg: string) => (connector as any).sendMessageTo(chatId, msg)
              : undefined,
          stop: () => connector.stop(),
        });
      } catch (error) {
        display.warningText(`[${plugin.metadata.name}] Could not start: ${error}`);
      }
    }

    // Build sidebar data from plugin contributions
    const workDir = this.codeEditor.getWorkDir();
    const sidebarContributions = this.pluginRegistry.getSidebarContributions();
    const sidebarItems = sidebarContributions.map(c => ({
      id: c.id,
      label: c.label,
      active: c.getStatus(),
      order: c.order,
    }));

    // Add connector sidebar items dynamically
    if (this.connectorRegistry.has('telegram')) {
      sidebarItems.push({ id: 'telegram', label: 'Telegram', active: true, order: 10 });
    }
    if (this.connectorRegistry.has('discord')) {
      sidebarItems.push({ id: 'discord', label: 'Discord', active: true, order: 11 });
    }

    // Sort by order
    sidebarItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const currentModelId = this.grokClient?.getCurrentModel() || 'grok-3';
    const providerId = inferProvider(currentModelId);
    const providerInfo = providerId ? PROVIDERS[providerId] : undefined;
    const providerName = providerInfo ? `${providerInfo.id} (${providerInfo.name})` : 'Unknown';
    const modelInfo = MODELS.find(m => m.id === currentModelId);
    const modelName = modelInfo?.name || currentModelId;
    const sidebarData: SidebarData = {
      model: modelName,
      provider: providerName,
      availableModels: this.grokClient?.getAvailableModels() || [],
      items: sidebarItems,
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
          // Update input placeholder for persistent paste
          const summary = getLastPasteSummary();
          if (summary && this.tuiApp) {
            this.tuiApp.setInputPlaceholder(`${summary} Type your message...`);
          } else if (this.tuiApp) {
            this.tuiApp.setInputPlaceholder('Type your message...');
          }
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

    // Wire thinking display to comm panel
    display.setThinkingCallback((chunk: string) => {
      tuiApp.appendThinking(chunk);
    });

    // Wire TUI spinner into ThinkingAnimation
    setTUISpinnerCallbacks({
      showSpinner: (label: string) => tuiApp.showSpinner(label),
      hideSpinner: () => tuiApp.hideSpinner(),
    });

    // Wire raw output callback to comm panel for response logging
    if (this.grokClient) {
      this.grokClient.setRawOutputCallback((chunk: string) => {
        tuiApp.logResponse(chunk);
      });
      this.grokClient.setResponseEndCallback(() => {
        tuiApp.endResponse();
      });
    }

    // Render header
    tuiApp.setHeader({
      version: VERSION,
      workingDir: workDir,
    });

    // Set initial sidebar
    tuiApp.updateSidebar(sidebarData);

    if (this.agentService) {
      this.refreshAgentTabs();
      await this.switchTab(this.agentService.getActiveAgentId());
    } else {
      tuiApp.updateTabs([{ id: 'main', label: 'Main' }], 'main');
    }

    // Subscribe to events for live sidebar updates
    const rebuildSidebar = () => {
      const contributions = this.pluginRegistry.getSidebarContributions();
      const items = contributions.map(c => ({
        id: c.id,
        label: c.label,
        active: c.getStatus(),
        order: c.order,
      }));
      // Add connector items
      if (this.connectorRegistry.has('telegram')) {
        items.push({ id: 'telegram', label: 'Telegram', active: true, order: 10 });
      }
      if (this.connectorRegistry.has('discord')) {
        items.push({ id: 'discord', label: 'Discord', active: true, order: 11 });
      }
      // Context size removed per request
      // Task count removed per request
      items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const currentModelId = this.grokClient?.getCurrentModel() || 'grok-3';
      const providerId = inferProvider(currentModelId);
      const providerInfo = providerId ? PROVIDERS[providerId] : undefined;
      const providerName = providerInfo ? `${providerInfo.id} (${providerInfo.name})` : 'Unknown';
      const modelInfo = MODELS.find(m => m.id === currentModelId);
      const modelName = modelInfo?.name || currentModelId;
      sidebarData.model = modelName;
      sidebarData.provider = providerName;
      sidebarData.availableModels = this.grokClient?.getAvailableModels() || [];
      sidebarData.items = items;
      tuiApp.updateSidebar(sidebarData);
    };
    this.eventBus.on('heartbeat:complete', rebuildSidebar);
    this.eventBus.on('heartbeat:started', rebuildSidebar);
    this.eventBus.on('connector:connected', rebuildSidebar);
    this.eventBus.on('wallet:unlocked', rebuildSidebar);
    this.eventBus.on('wallet:locked', rebuildSidebar);

    // Wire edit:applied events to DiffPanel (auto-opens on first diff)
    this.eventBus.on('edit:applied', e => {
      tuiApp.addDiffEntry(e.filePath, e.beforeContent, e.afterContent);
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

    // Check if in token mode without session (can't prompt in non-interactive)
    const savedConfig = this.configManager.getConfig();
    if (savedConfig.paymentMode === 'token' && walletExists() && !isSessionActive()) {
      display.errorText('Token mode requires wallet to be unlocked.');
      display.muted('Run slashbot interactively first to unlock, or switch to API key mode.');
      process.exit(1);
    }

    // Initialize Grok client
    await this.initializeGrok();

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

    // Unsubscribe from EventBus
    if (this.promptRedrawUnsubscribe) {
      this.promptRedrawUnsubscribe();
      this.promptRedrawUnsubscribe = null;
    }

    // Kill all background processes
    try {
      const { processManager } = await import('../../plugins/bash/services/ProcessManager');
      const killed = processManager.killAll();
      if (killed > 0) {
        display.muted(`[Process] Killed ${killed} background process(es)`);
      }
    } catch {
      // Ignore
    }

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
      const { mkdir } = await import('fs/promises');
      const configDir = getLocalSlashbotDir();
      await mkdir(configDir, { recursive: true });
      const historyToSave = this.history.slice(-500);
      await Bun.write(getLocalHistoryFile(), historyToSave.map(h => JSON.stringify(h)).join('\n'));
    } catch {
      // Ignore save errors
    }
    // Clear TUI callbacks and destroy TUI app (restores terminal state)
    setTUISpinnerCallbacks(null);
    display.setThinkingCallback(null);
    if (this.tuiApp) {
      this.tuiApp.destroy();
      this.tuiApp = null;
    }
  }
}
