/**
 * Grok API Client - Thin orchestrator delegating to streaming and agentic loop modules
 */

import { display } from '../ui';
import { getRecentImages, hasImages as hasImagesInBuffer } from '../code/imageBuffer';
import type { ActionHandlers } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { GROK_CONFIG, AGENTIC } from '../config/constants';

import type { Message, GrokConfig, UsageStats, ApiAuthProvider, ClientContext } from './types';
import { getEnvironmentInfo } from './utils';
import type { PromptAssembler } from './prompts/assembler';
import { SessionManager } from './sessions';
import { DirectAuthProvider, DEFAULT_CONFIG } from './auth';
import { streamResponse } from './streaming';
import { runAgenticLoop } from './agenticLoop';

export type { ActionHandlers } from '../actions';

export class GrokClient implements ClientContext {
  config: GrokConfig;
  sessionManager: SessionManager;
  actionHandlers: ActionHandlers = {};
  usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  thinkingActive = false;
  abortController: AbortController | null = null;
  authProvider: ApiAuthProvider;
  rawOutputCallback: ((text: string) => void) | null = null;

  private workDir: string = '';
  private projectContext: string = '';
  private promptAssembler: PromptAssembler | null = null;
  private assembledPromptCache: string | null = null;
  private responseEndCallback: (() => void) | null = null;

  constructor(config: GrokConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiKey) {
      throw new Error('GROK_API_KEY is required');
    }

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

  addMessage(msg: Message): void {
    this.sessionManager.addMessage(msg);
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

  async buildAssembledPrompt(): Promise<void> {
    if (this.promptAssembler) {
      this.assembledPromptCache = await this.promptAssembler.assemble();
      this.rebuildSystemPrompt();
    }
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
  }

  getCurrentModel(): string {
    return this.config.model || GROK_CONFIG.MODEL;
  }

  abort(): void {
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

    return hasImagesInBuffer() || hasImagesInHistory
      ? this.config.modelImage || 'grok-4-1-fast-reasoning'
      : this.config.model || 'grok-4-1-fast-reasoning';
  }

  // ===== Public chat methods =====

  async chat(userMessage: string): Promise<{ response: string; thinking: string }> {
    this.sessionManager.displayedContent = '';

    const recentImages = getRecentImages();
    const userContent: Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }> = [{ type: 'text', text: userMessage }];
    recentImages.forEach((imgUrl: string) => {
      userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
    });
    this.sessionManager.history.push({ role: 'user', content: userContent });

    this.sessionManager.compressContext();

    const messageHasImages = recentImages.length > 0;

    const result = await runAgenticLoop(this, messageHasImages, {
      displayStream: true,
      maxIterations: AGENTIC.MAX_ITERATIONS_CLI,
      cacheFileContents: true,
      includeFileContext: true,
      tokenLimitStrategy: 'condense',
      hallucinationDetection: 'full',
      emptyResponseRetry: true,
      editTagDebug: true,
      continueActions: true,
    });

    // Store final response in history
    const lastMessage = this.sessionManager.history[this.sessionManager.history.length - 1];
    if (lastMessage?.role !== 'assistant' || lastMessage?.content !== result.finalResponse) {
      this.sessionManager.history.push({ role: 'assistant', content: result.finalResponse });
    }

    // Inject executed actions into context
    if (result.executedActions.length > 0) {
      const actionSummary = result.executedActions
        .map(a => `- ${a.success ? '✓' : '✗'} ${a.description}`)
        .join('\n');

      this.sessionManager.history.push({
        role: 'user',
        content: `<session-actions>\n${actionSummary}\n</session-actions>`,
      });
    }

    const cleanResponse = cleanSelfDialogue(cleanXmlTags(result.finalResponse));

    // Defensive cleanup
    if (this.thinkingActive) {
      display.stopThinking();
      this.thinkingActive = false;
    }
    display.endThinkingStream();

    this.responseEndCallback?.();

    return {
      response: cleanResponse,
      thinking: result.finalThinking,
    };
  }

  /**
   * Chat with action execution for Telegram/Discord
   */
  async chatWithResponse(
    userMessage: string,
    source?: 'telegram' | 'discord',
    timeout: number = 120000,
    sessionId?: string,
  ): Promise<string> {
    const effectiveSessionId = sessionId || source || 'cli';
    this.sessionManager.setSession(effectiveSessionId);

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
      this.sessionManager.history.push({ role: 'user', content: userContent });
    } else {
      this.sessionManager.history.push({ role: 'user', content: userMessage + platformHint });
    }

    this.sessionManager.compressContext();

    const result = await runAgenticLoop(this, messageHasImages, {
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
    if (this.thinkingActive) {
      display.stopThinking();
      this.thinkingActive = false;
    }
    display.endThinkingStream();

    this.responseEndCallback?.();

    if (result.endMessage) {
      return result.endMessage;
    }

    const cleanResponse = cleanSelfDialogue(cleanXmlTags(result.finalResponse)).trim();

    if (cleanResponse) {
      display.sayResult(cleanResponse);
      return cleanResponse;
    } else if (result.actionsSummary.length > 0) {
      const summary = `Done: ${result.actionsSummary.join(', ')}`;
      display.sayResult(summary);
      return summary;
    }
    display.sayResult('Done.');
    return 'Done.';
  }

  // ===== Usage tracking =====

  getUsage(): UsageStats {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
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

export function createGrokClient(apiKey?: string, config?: { model?: string }): GrokClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new GrokClient({
    apiKey: key,
    model: config?.model,
  });
}
