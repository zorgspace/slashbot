/**
 * LLM Client - Thin orchestrator delegating to streaming and agentic loop modules
 * Provider-agnostic via Vercel AI SDK.
 */

import { display } from '../ui';
import {
  getRecentImages,
  hasImages as hasImagesInBuffer,
} from '../../plugins/filesystem/services/ImageBuffer';
import type { ConnectorSource } from '../../connectors/base';
import type { ActionHandlers } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { GROK_CONFIG, AGENTIC } from '../config/constants';

import type {
  Message,
  LLMConfig,
  UsageStats,
  ApiAuthProvider,
  ClientContext,
  ExecutionPolicy,
  ExecutionPolicyMode,
} from './types';
import { getEnvironmentInfo } from './utils';
import type { PromptAssembler } from './prompts/assembler';
import type { PromptAssemblyReport } from './prompts/assembler';
import type { ToolRegistry } from './toolRegistry';
import { SessionManager } from './sessions';
import type { SessionSummary } from './sessions';
import type { SessionUsageStats, SessionCompactionStats } from './sessions';
import { DirectAuthProvider, DEFAULT_CONFIG } from '../../plugins/providers/auth';
import { runAgenticLoop } from './agenticLoop';
import { ProviderRegistry } from '../../plugins/providers/registry';
import { PROVIDERS, inferProvider, MODELS } from '../../plugins/providers/models';

export type { ActionHandlers } from '../actions';

const ORCHESTRATOR_BLOCKED_TOOL_NAMES = [
  'read_file',
  'edit_file',
  'write_file',
  'glob',
  'grep',
  'ls',
  'bash',
];

const ORCHESTRATOR_BLOCKED_ACTION_TYPES = [
  'read',
  'edit',
  'write',
  'create',
  'glob',
  'grep',
  'ls',
  'bash',
];

export class LLMClient implements ClientContext {
  config: LLMConfig;
  sessionManager: SessionManager;
  actionHandlers: ActionHandlers = {};
  usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  thinkingActive = false;
  abortController: AbortController | null = null;
  authProvider: ApiAuthProvider;
  rawOutputCallback: ((text: string) => void) | null = null;
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry | null = null;

  private workDir: string = '';
  private projectContext: string = '';
  private promptAssembler: PromptAssembler | null = null;
  private assembledPromptCache: string | null = null;
  private responseEndCallback: (() => void) | null = null;
  private readonly abortControllersBySession = new Map<string, Set<AbortController>>();
  private readonly sessionExecutionLanes = new Map<string, Promise<void>>();

  constructor(config: LLMConfig, registry?: ProviderRegistry) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiKey) {
      throw new Error('API key is required');
    }

    // Set up provider registry
    this.providerRegistry = registry || new ProviderRegistry();

    // Auto-configure the provider from the config (skip if already configured by external registry)
    const providerId = this.config.provider || 'xai';
    if (!this.providerRegistry.isConfigured(providerId)) {
      this.providerRegistry.configure(providerId, {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });
    }

    // Direct auth provider for backwards compat (used by wallet proxy)
    this.authProvider = new DirectAuthProvider(
      this.config.apiKey,
      this.config.baseUrl || GROK_CONFIG.API_BASE_URL,
    );

    this.sessionManager = new SessionManager(() => this.buildSystemPrompt());
  }

  // ===== Auth =====

  setAuthProvider(provider: ApiAuthProvider): void {
    this.authProvider = provider;
  }

  // ===== Provider management =====

  getProvider(): string {
    return this.config.provider || 'xai';
  }

  setProvider(providerId: string, apiKey?: string): void {
    this.config.provider = providerId;
    if (apiKey) {
      const providerInfo = PROVIDERS[providerId];
      this.providerRegistry.configure(providerId, {
        apiKey,
        baseUrl: providerInfo?.baseUrl,
      });
    }
    // Set default model for the new provider
    const providerInfo = PROVIDERS[providerId];
    if (providerInfo) {
      this.config.model = providerInfo.defaultModel;
    }
  }

  getProviderRegistry(): ProviderRegistry {
    return this.providerRegistry;
  }

  // ===== Session delegates =====

  setSession(sessionId: string): void {
    this.sessionManager.setSession(sessionId);
  }

  getSessionId(): string {
    return this.sessionManager.getSessionId();
  }

  getSessionIds(): string[] {
    return this.sessionManager.getSessionIds();
  }

  getSessionSummaries(): SessionSummary[] {
    return this.sessionManager.getSessionSummaries();
  }

  getSessionUsage(sessionId: string): SessionUsageStats {
    return this.sessionManager.getSessionUsage(sessionId);
  }

  getSessionCompaction(sessionId: string): SessionCompactionStats {
    return this.sessionManager.getSessionCompaction(sessionId);
  }

  getSessionUsageSummaries(): Array<{ id: string; usage: SessionUsageStats }> {
    return this.sessionManager.getSessionUsageSummaries();
  }

  getSessionCompactionSummaries(): Array<{ id: string; compaction: SessionCompactionStats }> {
    return this.sessionManager.getSessionCompactionSummaries();
  }

  getSessionHistoryById(sessionId: string): Message[] {
    return this.sessionManager.getSessionHistoryById(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessionManager.clearSession(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessionManager.deleteSession(sessionId);
  }

  clearHistory(): void {
    this.sessionManager.clearHistory();
  }

  getHistory(): Message[] {
    return this.sessionManager.getHistory();
  }

  getHistoryForSession(sessionId: string): Message[] {
    return this.sessionManager.getHistoryForSession(sessionId);
  }

  addMessage(msg: Message): void {
    this.sessionManager.addMessage(msg);
  }

  addMessageToSession(sessionId: string, msg: Message): void {
    this.sessionManager.addMessageToSession(sessionId, msg);
  }

  setContextCompression(enabled: boolean, maxMessages?: number): void {
    this.sessionManager.setContextCompression(enabled, maxMessages);
  }

  isContextCompressionEnabled(): boolean {
    return this.sessionManager.isContextCompressionEnabled();
  }

  getMaxContextMessages(): number {
    return this.sessionManager.getMaxContextMessages();
  }

  getContextSize(): number {
    return this.sessionManager.getContextSize();
  }

  estimateTokens(): number {
    return this.sessionManager.estimateTokens();
  }

  // ===== Prompt assembly =====

  setPromptAssembler(assembler: PromptAssembler): void {
    this.promptAssembler = assembler;
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  async buildAssembledPrompt(): Promise<void> {
    if (this.promptAssembler) {
      this.promptAssembler.setProvider(this.getProvider());
      this.assembledPromptCache = await this.promptAssembler.assemble();
      this.rebuildSystemPrompt();
    }
  }

  getPromptReport(): PromptAssemblyReport | null {
    return this.promptAssembler?.getLastReport?.() ?? null;
  }

  private buildSystemPrompt(): string {
    let prompt = this.assembledPromptCache || 'You are a helpful assistant.';

    if (this.workDir) {
      prompt += '\n\nHere is useful information about the environment you are running in:';
      prompt += getEnvironmentInfo(this.workDir);
    }

    if (this.projectContext) {
      prompt += '\n\nPROJECT CONTEXT:\n' + this.projectContext;
    }

    return prompt;
  }

  private rebuildSystemPrompt(): void {
    this.sessionManager.rebuildAllSessionPrompts(this.buildSystemPrompt());
  }

  // ===== Configuration =====

  setActionHandlers(handlers: ActionHandlers): void {
    this.actionHandlers = handlers;
  }

  setRawOutputCallback(callback: (text: string) => void): void {
    this.rawOutputCallback = callback;
  }

  setResponseEndCallback(callback: () => void): void {
    this.responseEndCallback = callback;
  }

  setProjectContext(context: string, workDir?: string): void {
    this.projectContext = context;
    if (workDir) {
      this.workDir = workDir;
    }
    this.rebuildSystemPrompt();
  }

  setWorkDir(workDir: string): void {
    this.workDir = workDir;
    this.rebuildSystemPrompt();
  }

  setModel(model: string): void {
    this.config.model = model;
    // Auto-detect and switch provider if needed
    const detectedProvider = inferProvider(model);
    if (detectedProvider && detectedProvider !== this.config.provider) {
      this.config.provider = detectedProvider;
    }
  }

  getCurrentModel(): string {
    if (this.config.model) return this.config.model;
    const providerInfo = PROVIDERS[this.getProvider()];
    return providerInfo?.defaultModel || GROK_CONFIG.MODEL;
  }

  getAvailableModels(): string[] {
    const providerId = this.getProvider();
    return MODELS.filter((m: any) => m.provider === providerId).map((m: any) => m.id);
  }

  private registerAbortController(sessionId: string, controller: AbortController): void {
    let controllers = this.abortControllersBySession.get(sessionId);
    if (!controllers) {
      controllers = new Set<AbortController>();
      this.abortControllersBySession.set(sessionId, controllers);
    }
    controllers.add(controller);
    this.abortController = controller;
  }

  private unregisterAbortController(sessionId: string, controller: AbortController): void {
    const controllers = this.abortControllersBySession.get(sessionId);
    if (!controllers) {
      return;
    }
    controllers.delete(controller);
    if (controllers.size === 0) {
      this.abortControllersBySession.delete(sessionId);
    }
    if (this.abortController === controller) {
      this.abortController = this.getAnyAbortController();
    }
  }

  private getAnyAbortController(): AbortController | null {
    for (const controllers of this.abortControllersBySession.values()) {
      const first = controllers.values().next().value as AbortController | undefined;
      if (first) {
        return first;
      }
    }
    return null;
  }

  private async withSessionLane<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionExecutionLanes.get(sessionId) ?? Promise.resolve();
    let releaseLane!: () => void;
    const laneToken = new Promise<void>(resolve => {
      releaseLane = resolve;
    });
    this.sessionExecutionLanes.set(
      sessionId,
      previous.catch(() => undefined).then(() => laneToken),
    );

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      releaseLane();
      if (this.sessionExecutionLanes.get(sessionId) === laneToken) {
        this.sessionExecutionLanes.delete(sessionId);
      }
    }
  }

  private resolveSessionOutputTabId(sessionId: string): string | undefined {
    const normalized = sessionId.trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized.startsWith('agent:')) {
      const tabId = normalized.slice('agent:'.length).trim();
      return tabId || undefined;
    }
    return undefined;
  }

  private resolveExecutionPolicy(
    policy?: ExecutionPolicy | ExecutionPolicyMode,
  ): ExecutionPolicy | undefined {
    if (!policy) {
      return undefined;
    }

    const normalizedMode = typeof policy === 'string' ? policy : (policy.mode ?? 'default');
    if (normalizedMode !== 'orchestrator') {
      if (typeof policy === 'string') {
        return undefined;
      }
      return policy;
    }

    const basePolicy = typeof policy === 'string' ? {} : policy;
    return {
      ...basePolicy,
      mode: 'orchestrator',
      blockedToolNames: basePolicy.blockedToolNames || ORCHESTRATOR_BLOCKED_TOOL_NAMES,
      blockedActionTypes: basePolicy.blockedActionTypes || ORCHESTRATOR_BLOCKED_ACTION_TYPES,
      blockReason:
        basePolicy.blockReason ||
        'Architect lane is orchestration-only. Delegate implementation to specialist agents.',
    };
  }

  private inferSessionExecutionMode(sessionId: string): ExecutionPolicyMode | undefined {
    const history = this.sessionManager.getHistoryForSession(sessionId);
    const hasOrchestratorMarker = history.some(
      msg =>
        msg.role === 'system' &&
        typeof msg.content === 'string' &&
        msg.content.includes('Tab mode: ORCHESTRATOR.'),
    );
    return hasOrchestratorMarker ? 'orchestrator' : undefined;
  }

  private createAbortControllerBinder(
    sessionId: string,
  ): (controller: AbortController | null) => void {
    let activeController: AbortController | null = null;
    return (controller: AbortController | null) => {
      if (controller) {
        activeController = controller;
        this.registerAbortController(sessionId, controller);
        return;
      }
      if (activeController) {
        this.unregisterAbortController(sessionId, activeController);
        activeController = null;
      }
    };
  }

  abortSession(sessionId: string): boolean {
    const controllers = this.abortControllersBySession.get(sessionId);
    if (!controllers || controllers.size === 0) {
      return false;
    }
    this.abortControllersBySession.delete(sessionId);
    for (const controller of controllers) {
      controller.abort();
    }
    this.abortController = this.getAnyAbortController();
    return true;
  }

  abort(): void {
    for (const controllers of this.abortControllersBySession.values()) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    this.abortControllersBySession.clear();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.thinkingActive) {
      display.stopThinking();
      this.thinkingActive = false;
    }
  }

  isThinking(): boolean {
    return this.thinkingActive;
  }

  // ===== Model selection (implements ClientContext) =====

  getModel(): string {
    const hasImagesInHistory = this.sessionManager.history.some(msg => {
      if (Array.isArray(msg.content)) {
        return msg.content.some(part => part.type === 'image_url');
      }
      return false;
    });

    if (hasImagesInBuffer() || hasImagesInHistory) {
      if (this.config.modelImage) {
        return this.config.modelImage;
      }
      // Use provider's default image model
      const providerInfo = PROVIDERS[this.getProvider()];
      if (providerInfo?.defaultImageModel) {
        return providerInfo.defaultImageModel;
      }
    }

    if (this.config.model) return this.config.model;
    const defaultProviderInfo = PROVIDERS[this.getProvider()];
    return defaultProviderInfo?.defaultModel || GROK_CONFIG.MODEL;
  }

  // ===== Public chat methods =====

  async chat(
    userMessage: string,
    options?: {
      sessionId?: string;
      displayResult?: boolean;
      quiet?: boolean;
      outputTabId?: string;
      executionPolicy?: ExecutionPolicy | ExecutionPolicyMode;
    },
  ): Promise<{ response: string; thinking: string }> {
    // Pin this request to an explicit session ID when provided so tab switches
    // during generation cannot reroute output to another conversation.
    const effectiveSessionId = options?.sessionId || this.sessionManager.getSessionId();
    return this.withSessionLane(effectiveSessionId, async () => {
      const shouldDisplay = options?.displayResult !== false;
      const quiet = options?.quiet ?? false;
      const outputTabId = options?.outputTabId;
      const inferredMode = this.inferSessionExecutionMode(effectiveSessionId);
      const executionPolicy = this.resolveExecutionPolicy(
        options?.executionPolicy || inferredMode,
      );

      // Create a scoped session for this request
      const scope = this.sessionManager.scoped(effectiveSessionId);
      scope.displayedContent = '';

      const recentImages = getRecentImages();
      const userContent: Array<{
        type: 'text' | 'image_url';
        text?: string;
        image_url?: { url: string };
      }> = [{ type: 'text', text: userMessage }];
      recentImages.forEach((imgUrl: string) => {
        userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
      });
      scope.history.push({
        role: 'user',
        content: userContent,
        _render: {
          kind: 'user',
          text: userMessage,
        },
      });

      scope.compressContext();

      const messageHasImages = recentImages.length > 0;
      const onAbortControllerChange = this.createAbortControllerBinder(effectiveSessionId);

      // Build a scoped context so the agentic loop operates on the pinned session
      const ctx: ClientContext = {
        authProvider: this.authProvider,
        sessionManager: scope,
        sessionId: effectiveSessionId,
        outputTabId,
        executionPolicy,
        config: this.config,
        usage: this.usage,
        thinkingActive: this.thinkingActive,
        abortController: this.abortController,
        onAbortControllerChange,
        rawOutputCallback: this.rawOutputCallback,
        actionHandlers: this.actionHandlers,
        providerRegistry: this.providerRegistry,
        toolRegistry: this.toolRegistry,
        getModel: () => this.getModel(),
        getProvider: () => this.getProvider(),
        estimateTokens: () => this.estimateTokens(),
      };

      const result = await runAgenticLoop(ctx, messageHasImages, {
        displayStream: shouldDisplay,
        quiet,
        outputTabId,
        executionPolicy,
        maxIterations: AGENTIC.MAX_ITERATIONS_CLI,
        cacheFileContents: true,
        includeFileContext: true,
        tokenLimitStrategy: 'condense',
        hallucinationDetection: 'full',
        emptyResponseRetry: true,
        editTagDebug: true,
        continueActions: true,
      });

      // Sync back mutable state from the scoped context
      this.thinkingActive = ctx.thinkingActive;
      this.abortController = ctx.abortController;

      // Inject executed actions into context
      if (result.executedActions.length > 0) {
        const actionSummary = result.executedActions
          .map(a => `- ${a.success ? '\u2713' : '\u2717'} ${a.description}`)
          .join('\n');

        scope.history.push({
          role: 'user',
          content: `<session-actions>\n${actionSummary}\n</session-actions>`,
        });
      }

      const cleanResponse = cleanSelfDialogue(
        cleanXmlTags(result.endMessage || result.finalResponse),
      ).trim();

      // Defensive cleanup
      if (this.thinkingActive) {
        display.stopThinking();
        this.thinkingActive = false;
      }
      display.endThinkingStream();

      // Safety net: if nothing was displayed during streaming and no endMessage was shown,
      // display the cleaned response now. This handles cases where the LLM wraps everything
      // in action tags (as instructed) and the streaming display strips them.
      if (shouldDisplay && !scope.displayedContent && !result.endMessage && cleanResponse.trim()) {
        display.sayResult(cleanResponse, outputTabId);
      }

      this.responseEndCallback?.();

      return {
        response: cleanResponse,
        thinking: result.finalThinking,
      };
    });
  }

  /**
   * Run a stateless request in an isolated temporary session.
   * Used by background systems (e.g. heartbeat) to avoid contaminating chat context.
   */
  async chatIsolated(
    userMessage: string,
    options?: {
      quiet?: boolean;
      includeFileContext?: boolean;
      continueActions?: boolean;
      executeActions?: boolean;
      maxIterations?: number;
      outputTabId?: string;
      executionPolicy?: ExecutionPolicy | ExecutionPolicyMode;
    },
  ): Promise<{ response: string; thinking: string }> {
    const scopeId = `__isolated_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return this.withSessionLane(scopeId, async () => {
      const scope = this.sessionManager.scoped(scopeId);
      scope.displayedContent = '';
      scope.history.push({
        role: 'user',
        content: userMessage,
        _render: {
          kind: 'user',
          text: userMessage,
        },
      });
      const onAbortControllerChange = this.createAbortControllerBinder(scopeId);
      const outputTabId = options?.outputTabId;
      const executionPolicy = this.resolveExecutionPolicy(options?.executionPolicy);

      const ctx: ClientContext = {
        authProvider: this.authProvider,
        sessionManager: scope,
        sessionId: scopeId,
        outputTabId,
        executionPolicy,
        config: this.config,
        usage: this.usage,
        thinkingActive: false,
        abortController: null,
        onAbortControllerChange,
        rawOutputCallback: this.rawOutputCallback,
        actionHandlers: this.actionHandlers,
        providerRegistry: this.providerRegistry,
        toolRegistry: this.toolRegistry,
        getModel: () => this.getModel(),
        getProvider: () => this.getProvider(),
        estimateTokens: () => this.estimateTokens(),
      };

      try {
        const result = await runAgenticLoop(ctx, false, {
          displayStream: false,
          quiet: options?.quiet ?? true,
          outputTabId,
          executionPolicy,
          executeActions: options?.executeActions ?? true,
          maxIterations: options?.maxIterations ?? AGENTIC.MAX_ITERATIONS_CONNECTOR,
          cacheFileContents: false,
          includeFileContext: options?.includeFileContext ?? false,
          tokenLimitStrategy: 'condense',
          hallucinationDetection: 'basic',
          emptyResponseRetry: false,
          editTagDebug: false,
          continueActions: options?.continueActions ?? false,
          maxConsecutiveErrors: AGENTIC.MAX_CONSECUTIVE_ERRORS,
        });

        const response = cleanSelfDialogue(
          cleanXmlTags(result.endMessage || result.finalResponse),
        ).trim();
        return { response, thinking: result.finalThinking };
      } finally {
        this.sessionManager.deleteSession(scopeId);
        this.responseEndCallback?.();
      }
    });
  }

  async sendToSession(
    sessionId: string,
    message: string,
    options?: { run?: boolean; quiet?: boolean; outputTabId?: string; displayResult?: boolean },
  ): Promise<{ delivered: boolean; response?: string }> {
    if (!options?.run) {
      this.sessionManager.appendUserMessage(sessionId, message);
      return { delivered: true };
    }

    const outputTabId = options?.outputTabId || this.resolveSessionOutputTabId(sessionId);
    const { response } = await this.chatWithResponse(message, undefined, 120000, sessionId, {
      quiet: options?.quiet ?? false,
      outputTabId,
      displayResult: options?.displayResult ?? true,
    });
    return { delivered: true, response };
  }

  /**
   * Chat with action execution for connector sessions.
   */
  async chatWithResponse(
    userMessage: string,
    source?: ConnectorSource,
    timeout: number = 120000,
    sessionId?: string,
    options?: {
      displayResult?: boolean;
      quiet?: boolean;
      outputTabId?: string;
      executionPolicy?: ExecutionPolicy | ExecutionPolicyMode;
    },
  ): Promise<{ response: string; endMessage?: string }> {
    const effectiveSessionId = sessionId || source || 'cli';
    return this.withSessionLane(effectiveSessionId, async () => {
      // Create a scoped session pinned to this specific chat/channel.
      // This eliminates the race condition where concurrent requests
      // from different Telegram chats or Discord channels clobber each other.
      const scope = this.sessionManager.scoped(effectiveSessionId);

      const chatIdFromSession = sessionId?.includes(':') ? sessionId.split(':')[1] : undefined;
      const chatHint = chatIdFromSession ? ` CHAT:${chatIdFromSession}` : '';

      const platformHint = source
        ? `\n[PLATFORM: ${source.toUpperCase()}${chatHint} - Execute actions, then respond with a 1-2 sentence SUMMARY in plain language. NEVER include code, file contents, or technical details. Describe what was done simply (e.g., "Fixed the login bug" not code snippets).]`
        : '';

      const recentImages = getRecentImages();
      const messageHasImages = recentImages.length > 0;
      if (messageHasImages) {
        const userContent: Array<{
          type: 'text' | 'image_url';
          text?: string;
          image_url?: { url: string };
        }> = [{ type: 'text', text: userMessage + platformHint }];
        recentImages.forEach((imgUrl: string) => {
          userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
        });
        scope.history.push({
          role: 'user',
          content: userContent,
          _render: {
            kind: 'user',
            text: userMessage + platformHint,
          },
        });
      } else {
        scope.history.push({
          role: 'user',
          content: userMessage + platformHint,
          _render: {
            kind: 'user',
            text: userMessage + platformHint,
          },
        });
      }

      scope.compressContext();
      const onAbortControllerChange = this.createAbortControllerBinder(effectiveSessionId);
      const outputTabId = options?.outputTabId;
      const inferredMode = this.inferSessionExecutionMode(effectiveSessionId);
      const executionPolicy = this.resolveExecutionPolicy(
        options?.executionPolicy || inferredMode,
      );

      // Build a scoped context — each concurrent request gets its own
      // thinkingActive/abortController state so they don't interfere.
      const ctx: ClientContext = {
        authProvider: this.authProvider,
        sessionManager: scope,
        sessionId: effectiveSessionId,
        outputTabId,
        executionPolicy,
        config: this.config,
        usage: this.usage,
        thinkingActive: false,
        abortController: null,
        onAbortControllerChange,
        rawOutputCallback: this.rawOutputCallback,
        actionHandlers: this.actionHandlers,
        providerRegistry: this.providerRegistry,
        toolRegistry: this.toolRegistry,
        getModel: () => this.getModel(),
        getProvider: () => this.getProvider(),
        estimateTokens: () => this.estimateTokens(),
      };

      const result = await runAgenticLoop(ctx, messageHasImages, {
        displayStream: false,
        quiet: options?.quiet ?? false,
        outputTabId,
        executionPolicy,
        maxIterations: AGENTIC.MAX_ITERATIONS_CONNECTOR,
        iterationTimeout: 60000,
        overallTimeout: timeout,
        cacheFileContents: false,
        includeFileContext: false,
        tokenLimitStrategy: 'condense',
        hallucinationDetection: 'basic',
        emptyResponseRetry: false,
        editTagDebug: false,
        continueActions: false,
        maxConsecutiveErrors: AGENTIC.MAX_CONSECUTIVE_ERRORS,
      });

      if (result.earlyReturn) {
        return { response: result.earlyReturn, endMessage: result.endMessage };
      }

      // Defensive cleanup
      if (ctx.thinkingActive) {
        display.stopThinking();
        ctx.thinkingActive = false;
      }
      display.endThinkingStream();

      this.responseEndCallback?.();

      if (result.endMessage) {
        if (options?.displayResult !== false) {
          display.sayResult(result.endMessage, outputTabId);
        }
        return { response: result.endMessage, endMessage: result.endMessage };
      }

      const cleanResponse = cleanSelfDialogue(cleanXmlTags(result.finalResponse)).trim();

      const shouldDisplay = options?.displayResult !== false;

      if (cleanResponse) {
        if (shouldDisplay) {
          display.sayResult(cleanResponse, outputTabId);
        }
        return { response: cleanResponse, endMessage: result.endMessage };
      } else if (result.actionsSummary.length > 0) {
        const summary = `Done: ${result.actionsSummary.join(', ')}`;
        if (shouldDisplay) {
          display.sayResult(summary, outputTabId);
        }
        return { response: summary, endMessage: result.endMessage };
      }
      if (shouldDisplay) {
        display.sayResult('Done.', outputTabId);
      }
      return { response: 'Done.', endMessage: result.endMessage };
    });
  }

  // ===== Usage tracking =====

  getUsage(): UsageStats {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
    this.sessionManager.resetAllSessionMetrics();
  }

  // ===== Public methods for plugin access =====

  getApiConfig(): { apiKey: string; baseUrl: string } {
    return {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl || GROK_CONFIG.API_BASE_URL,
    };
  }

  trackUsage(usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): void {
    this.usage.promptTokens += usage.promptTokens || 0;
    this.usage.completionTokens += usage.completionTokens || 0;
    this.usage.totalTokens += usage.totalTokens || 0;
    this.usage.requests++;
  }
}

/** Backwards compatibility alias */
export const GrokClient = LLMClient;
export type GrokClient = LLMClient;

export function createGrokClient(
  apiKey?: string,
  config?: { provider?: string; model?: string },
): LLMClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new LLMClient({
    provider: config?.provider || 'xai',
    apiKey: key,
    model: config?.model,
  });
}

/** Create a client for any provider */
export function createLLMClient(provider: string, apiKey: string, model?: string): LLMClient {
  return new LLMClient({
    provider,
    apiKey,
    model,
  });
}
