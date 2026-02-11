/**
 * LLM Client - Thin orchestrator delegating to streaming and agentic loop modules
 * Provider-agnostic via Vercel AI SDK.
 */

import { display } from '../ui';
import {
  getRecentImages,
  hasImages as hasImagesInBuffer,
} from '../../plugins/filesystem/services/ImageBuffer';
import type { ActionHandlers } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { GROK_CONFIG, AGENTIC } from '../config/constants';

import type {
  Message,
  LLMConfig,
  GrokConfig,
  UsageStats,
  ApiAuthProvider,
  ClientContext,
} from './types';
import { getEnvironmentInfo } from './utils';
import type { PromptAssembler } from './prompts/assembler';
import type { PromptAssemblyReport } from './prompts/assembler';
import type { ToolRegistry } from './toolRegistry';
import { SessionManager } from './sessions';
import type { SessionSummary } from './sessions';
import type { SessionUsageStats, SessionCompactionStats } from './sessions';
import { DirectAuthProvider, DEFAULT_CONFIG } from '../../plugins/providers/auth';
import { streamResponse } from './streaming';
import { runAgenticLoop } from './agenticLoop';
import { ProviderRegistry } from '../../plugins/providers/registry';
import { PROVIDERS, inferProvider, MODELS } from '../../plugins/providers/models';

export type { ActionHandlers } from '../actions';

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
  private readonly abortControllersBySession = new Map<string, AbortController>();

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

  private bindAbortController(sessionId: string, controller: AbortController | null): void {
    if (controller) {
      this.abortControllersBySession.set(sessionId, controller);
      this.abortController = controller;
      return;
    }
    const previous = this.abortControllersBySession.get(sessionId);
    this.abortControllersBySession.delete(sessionId);
    if (previous && this.abortController === previous) {
      this.abortController = null;
    }
  }

  abortSession(sessionId: string): boolean {
    const controller = this.abortControllersBySession.get(sessionId);
    if (!controller) {
      return false;
    }
    controller.abort();
    this.abortControllersBySession.delete(sessionId);
    if (this.abortController === controller) {
      this.abortController = null;
    }
    return true;
  }

  abort(): void {
    for (const [sessionId, controller] of this.abortControllersBySession) {
      controller.abort();
      this.abortControllersBySession.delete(sessionId);
    }
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
    options?: { sessionId?: string; displayResult?: boolean; quiet?: boolean },
  ): Promise<{ response: string; thinking: string }> {
    // Pin this request to an explicit session ID when provided so tab switches
    // during generation cannot reroute output to another conversation.
    const effectiveSessionId = options?.sessionId || this.sessionManager.getSessionId();
    const shouldDisplay = options?.displayResult !== false;
    const quiet = options?.quiet ?? false;

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

    // Build a scoped context so the agentic loop operates on the pinned session
    const ctx: ClientContext = {
      authProvider: this.authProvider,
      sessionManager: scope,
      sessionId: effectiveSessionId,
      config: this.config,
      usage: this.usage,
      thinkingActive: this.thinkingActive,
      abortController: this.abortController,
      onAbortControllerChange: controller => this.bindAbortController(effectiveSessionId, controller),
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

    const cleanResponse = cleanSelfDialogue(cleanXmlTags(result.endMessage || result.finalResponse)).trim();

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
      display.sayResult(cleanResponse);
    }

    this.responseEndCallback?.();

    return {
      response: cleanResponse,
      thinking: result.finalThinking,
    };
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
      maxIterations?: number;
    },
  ): Promise<{ response: string; thinking: string }> {
    const scopeId = `__isolated_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

    const ctx: ClientContext = {
      authProvider: this.authProvider,
      sessionManager: scope,
      sessionId: scopeId,
      config: this.config,
      usage: this.usage,
      thinkingActive: false,
      abortController: null,
      onAbortControllerChange: controller => this.bindAbortController(scopeId, controller),
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

      const response = cleanSelfDialogue(cleanXmlTags(result.endMessage || result.finalResponse)).trim();
      return { response, thinking: result.finalThinking };
    } finally {
      this.sessionManager.deleteSession(scopeId);
      this.responseEndCallback?.();
    }
  }

  async sendToSession(
    sessionId: string,
    message: string,
    options?: { run?: boolean; quiet?: boolean },
  ): Promise<{ delivered: boolean; response?: string }> {
    if (!options?.run) {
      this.sessionManager.appendUserMessage(sessionId, message);
      return { delivered: true };
    }

    const response = await this.chatWithResponse(message, undefined, 120000, sessionId);
    void options?.quiet;
    return { delivered: true, response };
  }

  /**
   * Chat with action execution for Telegram/Discord
   */
  async chatWithResponse(
    userMessage: string,
    source?: 'telegram' | 'discord',
    timeout: number = 120000,
    sessionId?: string,
    options?: { displayResult?: boolean },
  ): Promise<string> {
    const effectiveSessionId = sessionId || source || 'cli';

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

    // Build a scoped context — each concurrent request gets its own
    // thinkingActive/abortController state so they don't interfere.
    const ctx: ClientContext = {
      authProvider: this.authProvider,
      sessionManager: scope,
      sessionId: effectiveSessionId,
      config: this.config,
      usage: this.usage,
      thinkingActive: false,
      abortController: null,
      onAbortControllerChange: controller => this.bindAbortController(effectiveSessionId, controller),
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
      return result.earlyReturn;
    }

    // Defensive cleanup
    if (ctx.thinkingActive) {
      display.stopThinking();
      ctx.thinkingActive = false;
    }
    display.endThinkingStream();

    this.responseEndCallback?.();

    if (result.endMessage) {
      return result.endMessage;
    }

    const cleanResponse = cleanSelfDialogue(cleanXmlTags(result.finalResponse)).trim();

    const shouldDisplay = options?.displayResult !== false;

    if (cleanResponse) {
      if (shouldDisplay) {
        display.sayResult(cleanResponse);
      }
      return cleanResponse;
    } else if (result.actionsSummary.length > 0) {
      const summary = `Done: ${result.actionsSummary.join(', ')}`;
      if (shouldDisplay) {
        display.sayResult(summary);
      }
      return summary;
    }
    if (shouldDisplay) {
      display.sayResult('Done.');
    }
    return 'Done.';
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

export function createGrokClient(apiKey?: string, config?: { model?: string }): LLMClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new LLMClient({
    provider: 'xai',
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
