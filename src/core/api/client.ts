/**
 * Grok API Client with Streaming and Thinking Mode
 */

import { display } from '../ui';
import {
  imageBuffer,
  getRecentImages,
  hasImages as hasImagesInBuffer,
  clearImages,
} from '../code/imageBuffer';
import { parseActions, executeActions, type ActionHandlers, type ActionResult } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { getRegisteredTags } from '../utils/tagRegistry';
import { GROK_CONFIG, AGENTIC } from '../config/constants';

import type { Message, GrokConfig, UsageStats, ApiAuthProvider } from './types';
import { compressActionResults, getEnvironmentInfo } from './utils';
import type { PromptAssembler } from './prompts/assembler';
import { SessionManager } from './sessions';

export type { ActionHandlers } from '../actions';

const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: GROK_CONFIG.MODEL,
  modelImage: GROK_CONFIG.MODEL_VISION,
  baseUrl: GROK_CONFIG.API_BASE_URL,
  maxTokens: GROK_CONFIG.MAX_TOKENS,
  temperature: GROK_CONFIG.TEMPERATURE,
};

/**
 * Default auth provider: direct API key auth against xAI
 */
class DirectAuthProvider implements ApiAuthProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  getEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  getHeaders(_requestBody: string): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}

/**
 * Options for the shared agentic loop
 */
interface AgenticLoopOptions {
  displayStream: boolean;
  maxIterations: number;
  iterationTimeout?: number;
  overallTimeout?: number;
  cacheFileContents: boolean;
  includeFileContext: boolean;
  tokenLimitStrategy: 'condense' | 'abort';
  hallucinationDetection: 'full' | 'basic';
  emptyResponseRetry: boolean;
  editTagDebug: boolean;
  continueActions: boolean;
  maxConsecutiveErrors?: number;
}

/**
 * Result from the agentic loop
 */
interface AgenticLoopResult {
  finalResponse: string;
  finalThinking: string;
  executedActions: Array<{ type: string; description: string; success: boolean }>;
  actionsSummary: string[];
  timedOut: boolean;
  earlyReturn?: string;
  endMessage?: string;
}

export class GrokClient {
  private config: GrokConfig;
  private sessionManager: SessionManager;
  private actionHandlers: ActionHandlers = {};
  private usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  private workDir: string = '';
  private abortController: AbortController | null = null;
  private thinkingActive = false;
  private projectContext: string = '';
  private promptAssembler: PromptAssembler | null = null;
  private assembledPromptCache: string | null = null;
  private authProvider: ApiAuthProvider;
  private rawOutputCallback: ((text: string) => void) | null = null;
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

  // ===== Model selection =====

  private getModel(): string {
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

  // ===== Agentic loop =====

  /**
   * Shared agentic loop used by both chat() and chatWithResponse()
   */
  private async runAgenticLoop(
    messageHasImages: boolean,
    opts: AgenticLoopOptions,
  ): Promise<AgenticLoopResult> {
    const executedActions: Array<{ type: string; description: string; success: boolean }> = [];
    const actionsSummary: string[] = [];
    let finalResponse = '';
    let finalThinking = '';
    let endMessage: string | undefined;
    let emptyResponseRetries = 0;
    const MAX_EMPTY_RETRIES = 2;
    let forcedRetryAttempted = false;
    let iteration = 0;
    let isFirstIteration = true;
    let consecutiveErrors = 0;
    let truncatedContent = '';
    const startTime = Date.now();

    // Edit safety guards
    const unresolvedEditPaths = new Set<string>();
    let blockedEndCount = 0;
    const MAX_BLOCKED_ENDS = 2;
    const readFiles = new Map<string, 'full' | 'partial'>();

    while (true) {
      iteration++;

      // Overall timeout check
      if (opts.overallTimeout && Date.now() - startTime > opts.overallTimeout) {
        if (this.thinkingActive) {
          display.stopThinking();
          this.thinkingActive = false;
        }
        display.endThinkingStream();
        const summary =
          actionsSummary.length > 0
            ? `Timeout after ${Math.round(opts.overallTimeout / 1000)}s. Completed: ${actionsSummary.join(', ')}`
            : `Timeout after ${Math.round(opts.overallTimeout / 1000)}s`;
        return {
          finalResponse,
          finalThinking,
          executedActions,
          actionsSummary,
          timedOut: true,
          earlyReturn: summary,
        };
      }

      let responseContent: string;
      let thinkingContent: string;
      let finishReason: string | null = null;

      try {
        const result = await this.streamResponse({
          showThinking: isFirstIteration,
          displayStream: opts.displayStream,
          timeout: opts.iterationTimeout,
          thinkingLabel: opts.displayStream ? 'Reflection...' : 'Thinking...',
        });
        isFirstIteration = false;
        responseContent = result.content;
        thinkingContent = result.thinking;
        finishReason = result.finishReason;

        if (opts.displayStream) {
          responseContent = responseContent.replace(/``/g, '');
        }
      } catch (error: any) {
        if (
          opts.tokenLimitStrategy === 'condense' &&
          error.message?.includes('maximum prompt length')
        ) {
          display.warningText(
            '[Token limit reached] Creating condensed context and coming back fresh...',
          );

          const condensedSummary = this.sessionManager.condenseHistory();
          display.muted(
            `[Context] Condensed ${this.sessionManager.history.length} messages into 1 summary`,
          );

          this.sessionManager.history = [
            this.sessionManager.history[0],
            { role: 'user', content: condensedSummary },
          ];

          try {
            const result = await this.streamResponse({ displayStream: opts.displayStream });
            responseContent = result.content;
            thinkingContent = result.thinking;
            finishReason = result.finishReason;
          } catch (retryError: any) {
            display.errorText(`[API Error after condensation] ${retryError.message || retryError}`);
            throw retryError;
          }
        } else if (error.name === 'TokenModeError') {
          display.violet(`[ERROR] ${error.message}`);
          display.violet(error.details);
          throw error;
        } else {
          display.errorText(`[API Error] ${error.message || error}`);
          throw error;
        }
      }

      // Merge with previously truncated content
      if (truncatedContent) {
        responseContent = truncatedContent + responseContent;
        truncatedContent = '';
      }

      finalResponse = responseContent;
      finalThinking += thinkingContent;

      // Clear images after first API call
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Auto-continue on truncated edit/write (regardless of finish_reason)
      const hasUnclosedEdit = /<edit\b[^>]*>/i.test(responseContent) && !/<\/edit>/i.test(responseContent);
      const hasUnclosedWrite = /<write\b[^>]*>/i.test(responseContent) && !/<\/write>/i.test(responseContent);
      if (hasUnclosedEdit || hasUnclosedWrite) {
        const tag = hasUnclosedEdit ? 'edit' : 'write';
        display.warningText(`[Truncated] Response cut off mid-<${tag}> — auto-continuing...`);
        truncatedContent = responseContent;
        this.sessionManager.history.push({ role: 'assistant', content: responseContent });
        this.sessionManager.history.push({
          role: 'user',
          content: `Your response was truncated mid-<${tag}> block (output token limit reached). Continue EXACTLY where you left off — output only the remaining content to complete the <${tag}> block and close it with </${tag}>.`,
        });
        continue;
      }
      if (finishReason === 'length') {
        display.muted(`[finish_reason: length] Response may be truncated`);
      }

      // Parse actions
      const actions = parseActions(responseContent);

      // Edit tag debug logging (CLI mode)
      if (opts.editTagDebug) {
        const editTagMatch = responseContent.match(/<edit[^>]*>|<\/edit>/gi);
        const hasEditTags = editTagMatch && editTagMatch.length > 0;
        const hasEditAction = actions.some(a => a.type === 'edit');
        if (hasEditTags && !hasEditAction) {
          display.warningText('[DEBUG] Edit tag detected but not parsed:');
          const editStart = responseContent.indexOf('<edit');
          const editEnd = responseContent.lastIndexOf('</edit>');
          const hasClosingTag = editEnd !== -1 && editEnd > editStart;
          const portion =
            editStart !== -1 && hasClosingTag
              ? responseContent.slice(editStart, editEnd + 7)
              : editStart !== -1
                ? responseContent.slice(editStart)
                : responseContent;
          if (!hasClosingTag) {
            display.warningText('[DEBUG] Missing </edit> closing tag — response may be truncated');
          }
          display.muted('--- Raw edit block ---');
          for (const line of portion.split('\n')) {
            display.append(line);
          }
          display.muted('--- End debug ---');
        }
      }


      // Read tracking: update readFiles map from parsed actions
      for (const action of actions) {
        if (action.type === 'read') {
          const path = (action as { path?: string }).path;
          if (path) {
            const hasOffset = (action as { offset?: number }).offset !== undefined;
            const hasLimit = (action as { limit?: number }).limit !== undefined;
            const coverage = hasOffset || hasLimit ? 'partial' : 'full';
            // Never downgrade full → partial
            if (readFiles.get(path) !== 'full') {
              readFiles.set(path, coverage);
            }
          }
        }
      }

      // Edit validation: reject edits on files not fully read
      const syntheticResults: ActionResult[] = [];
      const filteredActions = actions.filter(action => {
        if (action.type === 'edit') {
          const path = (action as { path?: string }).path;
          if (path && readFiles.get(path) !== 'full') {
            const wasPartial = readFiles.get(path) === 'partial';
            syntheticResults.push({
              action: `Edit: ${path}`,
              success: false,
              result: 'Blocked',
              error: wasPartial
                ? `Cannot edit ${path} — you only read part of this file. Use <read path="${path}"/> (without offset/limit) to read the entire file first, then retry the edit.`
                : `Cannot edit ${path} — you have not read this file yet. Use <read path="${path}"/> first, then retry the edit using the exact content and line numbers from the <read> output.`,
            });
            return false;
          }
        }
        return true;
      });

      const executedResults = await executeActions(filteredActions, this.actionHandlers);
      const actionResults = [...syntheticResults, ...executedResults];

      // Track unresolved edit failures
      for (const r of actionResults) {
        const action = String(r.action ?? '');
        if (action.startsWith('Edit:')) {
          const path = action.replace(/^Edit:\s*/, '').trim();
          if (r.success) {
            unresolvedEditPaths.delete(path);
          } else {
            unresolvedEditPaths.add(path);
            readFiles.delete(path);
          }
        } else if (action.startsWith('Write:') && r.success) {
          const path = action.replace(/^Write:\s*/, '').trim();
          unresolvedEditPaths.delete(path);
        }
      }

      // Continue action support
      if (opts.continueActions) {
        const hasContinueAction = actions.some(a => a.type === 'continue');
        if (hasContinueAction) {
          iteration = 0;
          this.sessionManager.history.push({ role: 'assistant', content: responseContent });
          this.sessionManager.history.push({
            role: 'user',
            content: `Continuing task as requested by <continue> action.\n\n${compressActionResults(actionResults)}\n\n<system-instruction>Continue the task.</system-instruction>`,
          });
          continue;
        }
      }

      // Hard limit
      if (iteration >= opts.maxIterations) {
        this.sessionManager.history.push({ role: 'assistant', content: responseContent });
        break;
      }

      // End action: block if unresolved edit failures remain
      const endResult = actionResults.find(r => r.action === 'End');
      if (endResult) {
        if (unresolvedEditPaths.size > 0 && blockedEndCount < MAX_BLOCKED_ENDS) {
          blockedEndCount++;
          const failedList = Array.from(unresolvedEditPaths).join(', ');
          this.sessionManager.history.push({ role: 'assistant', content: responseContent });
          this.sessionManager.history.push({
            role: 'user',
            content: [
              `BLOCKED: You cannot finish — the following files have unresolved edit failures: ${failedList}`,
              '',
              'You MUST either:',
              '1. Re-read each failed file with <read path="..."/>, then retry the edit using EXACT content and line numbers from the <read> output',
              '2. Use <write> to overwrite the file if the edit is too complex',
              '3. Honestly acknowledge in your <end> message that the edit could not be applied',
              '',
              'Do NOT claim success when edits have failed.',
            ].join('\n'),
          });
          continue;
        }
        if (endResult.result) {
          display.sayResult(endResult.result);
          endMessage = endResult.result;
        }
        this.sessionManager.history.push({ role: 'assistant', content: responseContent });
        break;
      }

      // Say action: display message but continue the loop
      const hasSayAction = actionResults.some(r => r.action === 'Says');
      if (hasSayAction) {
        const sayResult = actionResults.find(r => r.action === 'Says');
        if (sayResult?.result) {
          display.sayResult(sayResult.result);
        }
      }

      // Consecutive error tracking (connector mode)
      if (opts.maxConsecutiveErrors !== undefined) {
        const errorCount = actionResults.filter(r => !r.success).length;
        if (errorCount === actionResults.length && actionResults.length > 0) {
          consecutiveErrors++;
          if (consecutiveErrors >= opts.maxConsecutiveErrors) {
            const failedActions = actionResults.map(r => r.action).join(', ');
            const errorMsg = `Stopped after ${opts.maxConsecutiveErrors} consecutive failures. Last errors: ${failedActions}`;
            display.errorText(errorMsg);
            if (this.thinkingActive) {
              display.stopThinking();
              this.thinkingActive = false;
            }
            display.endThinkingStream();
            return {
              finalResponse,
              finalThinking,
              executedActions,
              actionsSummary,
              timedOut: false,
              earlyReturn: errorMsg,
            };
          }
        } else {
          consecutiveErrors = 0;
        }
      }

      // Cache file contents (CLI mode)
      if (opts.cacheFileContents) {
        for (const result of actionResults) {
          const action = String(result.action ?? '');
          const success = Boolean(result.success);
          executedActions.push({
            type: action.split('(')[0].trim(),
            description: action,
            success,
          });

          if (action.startsWith('Read:') && success && result.result) {
            const filePath = action.replace('Read: ', '').trim();
            if (result.result.length < 50000) {
              this.sessionManager.fileContextCache.set(filePath, result.result);
            }
          }
          if (action.startsWith('Edit:') && success && this.actionHandlers.onRead) {
            const filePath = action.replace(/^Edit: /, '').trim();
            try {
              const newContent = await this.actionHandlers.onRead(filePath);
              if (newContent && newContent.length < 50000) {
                this.sessionManager.fileContextCache.set(filePath, newContent);
              }
            } catch {
              // Ignore read errors
            }
          }
          if (action.startsWith('Write:') && success && this.actionHandlers.onRead) {
            const filePath = action.replace('Write: ', '').trim();
            try {
              const newContent = await this.actionHandlers.onRead(filePath);
              if (newContent && newContent.length < 50000) {
                this.sessionManager.fileContextCache.set(filePath, newContent);
              }
            } catch {
              // Ignore read errors
            }
          }
          if (action.startsWith('Grep:') && success && result.result) {
            const grepKey = `grep:${action}`;
            if (result.result.length < 50000) {
              this.sessionManager.fileContextCache.set(grepKey, result.result);
            }
          }
        }
      } else {
        // Connector mode: just build summary
        for (const r of actionResults) {
          const status = (r as { success?: boolean }).success ? '✓' : '✗';
          const action = (r as { action?: string }).action ?? '';
          actionsSummary.push(`${status} ${action}`);
        }
      }

      // No actions executed: hallucination detection
      if (actionResults.length === 0) {
        // Empty response retry (CLI mode)
        if (opts.emptyResponseRetry && thinkingContent && !responseContent.trim()) {
          emptyResponseRetries++;
          if (emptyResponseRetries >= MAX_EMPTY_RETRIES) {
            if (forcedRetryAttempted) {
              display.errorText('[Model failed to respond after forced retry - stopping]');
              break;
            }
            display.warningText('[Model stopped producing responses after retries]');
            display.muted('Last thinking: ' + thinkingContent);
            this.sessionManager.history.push({
              role: 'assistant',
              content: '[Incomplete - model stopped responding]',
            });
            this.sessionManager.history.push({
              role: 'user',
              content:
                'CRITICAL: You stopped mid-task. Your last thought was: ' +
                thinkingContent +
                '. Execute that action NOW or explain what went wrong.',
            });
            forcedRetryAttempted = true;
            continue;
          }
          this.sessionManager.history.push({ role: 'assistant', content: '[Thinking...]' });
          this.sessionManager.history.push({
            role: 'user',
            content:
              "You were thinking but didn't provide a response. Execute your planned action NOW.",
          });
          continue;
        }

        // Full hallucination detection (CLI mode)
        if (opts.hallucinationDetection === 'full') {
          const hasCloseEdit = /<\/edit/i.test(responseContent);
          const hasProperEditOpen = /<edit\s+path=["'][^"']+["'][^>]*>[\s\S]*?@@ -\d+,\d+ @@/i.test(
            responseContent,
          );
          if (hasCloseEdit && !hasProperEditOpen) {
            this.sessionManager.history.push({ role: 'assistant', content: responseContent });
            this.sessionManager.history.push({
              role: 'user',
              content: `ERROR: Malformed <edit> tag. You must use the unified diff format exactly:\n\n<edit path="file.ts">\n@@ -startLine,count @@\n-line to remove\n+line to add\n context line (unchanged, starts with a space)\n</edit>\n\n- startLine: 1-based line number from <read> output where this hunk begins.\n- count: number of existing lines this hunk spans (context + removed). Use 0 for pure insertion.\n- Every line inside a hunk MUST start with \` \` (space), \`-\`, or \`+\`.\n\nRead the file first with <read> to see actual line numbers and content.`,
            });
            continue;
          }
        }

        // Code hallucination detection (both modes)
        const codePatterns = [
          /^(async\s+)?(function|class|const|let|var|export|import)\s+/m,
          /constructor\s*\([^)]*\)\s*\{/m,
          /^\s*(public|private|protected)\s+/m,
        ];
        const looksLikeCode = codePatterns.some(p => p.test(responseContent));

        if (looksLikeCode && !responseContent.includes('```')) {
          this.sessionManager.history.push({ role: 'assistant', content: responseContent });
          this.sessionManager.history.push({
            role: 'user',
            content:
              opts.hallucinationDetection === 'full'
                ? `ERROR: You outputted code directly instead of using actions. NEVER output raw code - always use <read path="..."/> to check actual file content, then <edit path="...">@@ -line,count @@\n-old\n+new\n</edit> to make changes. Do NOT hallucinate file contents from memory.`
                : `ERROR: You outputted code directly instead of using actions. Use <read path="..."/> to check files, then <edit path="...">...</edit> to make changes. Do NOT hallucinate file contents.`,
          });
          continue;
        }

        // No actions, not a hallucination — done
        this.sessionManager.history.push({ role: 'assistant', content: responseContent });
        break;
      }

      // Reset retry counters on successful action execution
      emptyResponseRetries = 0;
      forcedRetryAttempted = false;

      // Feed compressed results back to continue the conversation
      const compressedResults = compressActionResults(actionResults);
      this.sessionManager.history.push({ role: 'assistant', content: responseContent });

      // Build file context: only filenames (contents already in action-output)
      let fileContext = '';
      if (opts.includeFileContext && this.sessionManager.fileContextCache.size > 0) {
        const filenames = Array.from(this.sessionManager.fileContextCache.keys()).filter(
          k => !k.startsWith('grep:'),
        );
        if (filenames.length > 0) {
          fileContext = `\nFiles in context: ${filenames.join(', ')}`;
        }
      }

      // Build continuation prompt
      const hasErrors = actionResults.some(r => !r.success);
      const failedEditPaths = actionResults
        .filter(r => !r.success && String(r.action ?? '').startsWith('Edit:'))
        .map(r => String(r.action ?? '').replace(/^Edit:\s*/, '').trim());

      const iterationWarning =
        iteration >= 15
          ? `\n[WARNING] ${iteration} iterations. Use <continue/> or <end> to finish.`
          : '';

      let instruction: string;
      if (hasErrors && failedEditPaths.length > 0) {
        instruction = [
          `EDIT FAILED on: ${failedEditPaths.join(', ')}`,
          'You MUST <read path="..."/> the file before retrying.',
          'Copy EXACT content from the <read> output — do not rely on memory.',
          'Use correct line numbers shown in the <read> output for @@ hunk headers.',
        ].join('\n');
      } else if (hasErrors) {
        instruction = 'ERROR DETECTED — fix it now.';
      } else {
        instruction = 'Continue or <end> to finish.';
      }

      const continuationPrompt = `${compressedResults}${fileContext}${iterationWarning}\n${instruction}`;

      this.sessionManager.history.push({ role: 'user', content: continuationPrompt });
    }

    return { finalResponse, finalThinking, executedActions, actionsSummary, timedOut: false, endMessage };
  }

  // ===== Public chat methods =====

  async chat(userMessage: string): Promise<{ response: string; thinking: string }> {
    this.sessionManager.displayedContent = '';

    // Add user message with recent images as vision context
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

    const result = await this.runAgenticLoop(messageHasImages, {
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
   * Chat with action execution for Telegram/Discord - streams thinking and actions to CLI
   */
  async chatWithResponse(
    userMessage: string,
    source?: 'telegram' | 'discord',
    timeout: number = 120000,
    sessionId?: string,
  ): Promise<string> {
    const effectiveSessionId = sessionId || source || 'cli';
    this.sessionManager.setSession(effectiveSessionId);

    // Parse chatId from sessionId (e.g., "telegram:12345" → "12345")
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

    const result = await this.runAgenticLoop(messageHasImages, {
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

    // Early return from loop (say action, timeout, consecutive errors)
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

    // Use the end message if the LLM provided one via <end>
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

  // ===== Streaming =====

  /**
   * Unified streaming method for both CLI and connector modes.
   */
  private async streamResponse(options?: {
    showThinking?: boolean;
    displayStream?: boolean;
    timeout?: number;
    thinkingLabel?: string;
  }): Promise<{ content: string; thinking: string; finishReason: string | null }> {
    const showThinking = options?.showThinking ?? true;
    const displayStream = options?.displayStream ?? true;
    const timeout = options?.timeout;
    const thinkingLabel = options?.thinkingLabel ?? 'Thinking...';

    if (this.authProvider.beforeRequest) {
      await this.authProvider.beforeRequest();
    }

    if (displayStream) {
      console.log();
    }

    const requestBody: Record<string, unknown> = {
      model: this.getModel(),
      messages: this.sessionManager.history,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    let responseContent = '';
    let thinkingContent = '';
    let displayedContent = '';
    let buffer = '';
    let finishReason: string | null = null;
    this.thinkingActive = true;
    let firstChunk = true;
    let thinkingStreamStarted = false;

    this.abortController = new AbortController();

    let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
    if (timeout) {
      fetchTimeout = setTimeout(() => this.abortController?.abort(), timeout);
    }

    // Always show spinner while waiting for API response
    display.startThinking(thinkingLabel);
    if (showThinking) {
      display.startThinkingStream();
    }

    const callNum = ++this.usage.requests;
    const startPromptTokens = this.usage.promptTokens;
    const startCompletionTokens = this.usage.completionTokens;
    const estPromptTokens = this.estimateTokens();

    display.streamThinkingChunk(
      `\n🛫 Grok API #${callNum} → ${this.getModel()} (~${estPromptTokens} prompt tokens)\n`,
    );

    // Log the prompt to CommPanel
    const lastMsg = this.sessionManager.history[this.sessionManager.history.length - 1];
    if (lastMsg) {
      let promptText = '';
      if (typeof lastMsg.content === 'string') {
        promptText = lastMsg.content;
      } else if (Array.isArray(lastMsg.content)) {
        const textPart = lastMsg.content.find((p: any) => p.type === 'text');
        promptText = textPart?.text || '';
      }
      if (promptText) {
        display.logPrompt(promptText);
      }
    }

    try {
      const requestBodyJson = JSON.stringify(requestBody);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.authProvider.getHeaders(requestBodyJson),
      };

      const response = await fetch(this.authProvider.getEndpoint(), {
        method: 'POST',
        headers,
        body: requestBodyJson,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (this.authProvider.onStreamChunk) {
              this.authProvider.onStreamChunk(parsed);
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            const content = delta?.content;

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }

            if (parsed.usage) {
              this.usage.promptTokens += parsed.usage.prompt_tokens || 0;
              this.usage.completionTokens += parsed.usage.completion_tokens || 0;
              this.usage.totalTokens += parsed.usage.total_tokens || 0;
            }

            if (delta?.reasoning_content) {
              if (!thinkingStreamStarted) {
                thinkingStreamStarted = true;
              }
              thinkingContent += delta.reasoning_content;
              if (showThinking) {
                display.streamThinkingChunk(delta.reasoning_content);
              }
            }

            if (content) {
              responseContent += content;

              this.rawOutputCallback?.(content);

              if (displayStream) {
                const tagAlt = getRegisteredTags().join('|');
                const openTags = (
                  responseContent.match(new RegExp(`<(${tagAlt})\\b[^>]*>`, 'gi')) || []
                ).length;
                const closeTags = (
                  responseContent.match(new RegExp(`</(${tagAlt})>|/>`, 'gi')) || []
                ).length;
                const hasUnclosedTag = openTags > closeTags;
                const partialTagMatch = responseContent.match(/<[a-z-]*$/i);
                const hasPartialTag = partialTagMatch !== null;

                if (!hasUnclosedTag && !hasPartialTag) {
                  let cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
                  cleanFull = cleanFull.replace(/^Assistant:\s*/gim, '');
                  const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
                  const newContent = normalized.slice(this.sessionManager.displayedContent.length);
                  if (newContent && newContent.trim()) {
                    const isDuplicate = this.sessionManager.displayedContent.includes(
                      newContent.trim(),
                    );
                    if (!isDuplicate) {
                      if (firstChunk) {
                        if (this.thinkingActive) {
                          display.stopThinking();
                          this.thinkingActive = false;
                        }
                        if (showThinking) {
                          display.endThinkingStream();
                        }
                        firstChunk = false;
                      }
                      displayedContent = normalized;
                      this.sessionManager.displayedContent = normalized;
                    }
                  }
                }
              } else {
                if (this.thinkingActive) {
                  display.stopThinking();
                  this.thinkingActive = false;
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      const deltaPrompt = this.usage.promptTokens - startPromptTokens;
      const deltaCompletion = this.usage.completionTokens - startCompletionTokens;

      display.streamThinkingChunk(
        `🛬 #${callNum} ← ${deltaPrompt}p + ${deltaCompletion}c tokens\n`,
      );
    } finally {
      if (fetchTimeout) {
        clearTimeout(fetchTimeout);
      }
      if (this.thinkingActive) {
        display.stopThinking();
        this.thinkingActive = false;
      }
      if (showThinking) {
        display.endThinkingStream();
      }
      this.abortController = null;
    }

    if (thinkingContent && !responseContent.trim()) {
      display.warningText('[Model produced thinking but no response - may need to retry]');
    }

    return { content: responseContent, thinking: thinkingContent, finishReason };
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
