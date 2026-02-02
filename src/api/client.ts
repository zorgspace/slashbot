/**
 * Grok API Client with Streaming and Thinking Mode
 */

import { colors, c, ThinkingAnimation, thinkingDisplay } from '../ui/colors';
import {
  imageBuffer,
  getRecentImages,
  hasImages as hasImagesInBuffer,
  clearImages,
} from '../code/imageBuffer';
import { parseActions, executeActions, type ActionHandlers } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { GROK_CONFIG } from '../config/constants';

import type { Message, GrokConfig, UsageStats } from './types';
import { SYSTEM_PROMPT } from './prompts/system';
import { compressActionResults, getEnvironmentInfo } from './utils';

export type { ActionHandlers } from '../actions';

const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: GROK_CONFIG.MODEL,
  modelImage: GROK_CONFIG.MODEL_VISION,
  baseUrl: GROK_CONFIG.API_BASE_URL,
  maxTokens: GROK_CONFIG.MAX_TOKENS,
  temperature: GROK_CONFIG.TEMPERATURE,
};

export class GrokClient {
  private config: GrokConfig;
  private conversationHistory: Message[] = [];
  private actionHandlers: ActionHandlers = {};
  private usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  private contextCompressionEnabled: boolean = true;
  private maxContextMessages: number = 200;
  private workDir: string = '';
  private abortController: AbortController | null = null;
  private currentThinking: ThinkingAnimation | null = null;
  private projectContext: string = '';
  private personalityMod: string = '';

  constructor(config: GrokConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiKey) {
      throw new Error('GROK_API_KEY is required');
    }

    this.conversationHistory.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
  }

  setActionHandlers(handlers: ActionHandlers): void {
    this.actionHandlers = handlers;
  }

  /**
   * Get the appropriate model based on whether images exist in conversation
   * Must use vision model if ANY message in history contains images
   */
  private getModel(): string {
    // Check if any message in conversation history contains images
    const hasImagesInHistory = this.conversationHistory.some(msg => {
      if (Array.isArray(msg.content)) {
        return msg.content.some(part => part.type === 'image_url');
      }
      return false;
    });

    // Use vision model if images in buffer OR in conversation history
    return hasImagesInBuffer() || hasImagesInHistory
      ? this.config.modelImage || 'grok-4-1-fast-reasoning'
      : this.config.model || 'grok-4-1-fast-reasoning';
  }

  private rebuildSystemPrompt(): void {
    if (this.conversationHistory.length === 0 || this.conversationHistory[0].role !== 'system')
      return;

    let prompt = SYSTEM_PROMPT;

    // Add environment info
    prompt += '\n\nHere is useful information about the environment you are running in:';
    prompt += getEnvironmentInfo(this.workDir);

    // Add personality modifier
    if (this.personalityMod) {
      prompt += this.personalityMod;
    }

    // Add project context
    if (this.projectContext) {
      prompt += '\n\nPROJECT CONTEXT:\n' + this.projectContext;
    }

    this.conversationHistory[0].content = prompt;
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

  setPersonality(personality: 'normal' | 'depressed' | 'sarcasm' | 'unhinged'): void {
    const mods: Record<string, string> = {
      normal: '',
      depressed:
        '\n\nPERSONALITY: Depressed, melancholic. Sigh often. Question existence. Still help, but lament.',
      sarcasm:
        '\n\nPERSONALITY: Sarcastic, witty, condescending. Roll eyes at obvious things. Still helpful.',
      unhinged:
        '\n\nPERSONALITY: UNHINGED. No filter. Roast bad code. Use profanity. Brutally honest.',
    };

    this.personalityMod = mods[personality] || '';
    this.rebuildSystemPrompt();
  }

  getPersonality(): string {
    const content = (this.conversationHistory[0]?.content as string) || '';
    if (content.includes('UNHINGED')) return 'unhinged';
    if (content.includes('depressed') || content.includes('melancholic')) return 'depressed';
    if (content.includes('sarcastic') || content.includes('condescending')) return 'sarcasm';
    return 'normal';
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentThinking) {
      this.currentThinking.stop();
      this.currentThinking = null;
    }
  }

  isThinking(): boolean {
    return this.currentThinking !== null;
  }

  async chat(userMessage: string): Promise<{ response: string; thinking: string }> {
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
    this.conversationHistory.push({
      role: 'user',
      content: userContent,
    });

    // Compress context if enabled
    this.compressContext();

    // Track if this message has images (for model selection)
    const messageHasImages = recentImages.length > 0;

    let finalResponse = '';
    let finalThinking = '';

    // Track files read in this conversation to prevent duplicate reads
    const filesReadThisTurn = new Set<string>();
    let duplicateReadCount = 0;
    const MAX_DUPLICATE_READS = 3; // Stop if LLM keeps trying to read same file
    let emptyResponseRetries = 0;
    const MAX_EMPTY_RETRIES = 2; // Max retries when model produces thinking but no content

    // Agentic loop: execute actions and feed results back (no iteration limit)
    while (true) {
      let responseContent: string;
      let thinkingContent: string;
      try {
        const result = await this.streamResponse();
        responseContent = result.content;
        thinkingContent = result.thinking;
      } catch (error: any) {
        console.error(`\n${c.error('[API Error]')} ${error.message || error}`);
        throw error;
      }
      finalResponse = responseContent;
      finalThinking += thinkingContent;

      // Clear images after first API call (they've been sent, don't need image model anymore)
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Execute actions and collect results
      let actions = parseActions(responseContent);

      // Filter out duplicate read actions (prevent reading same file multiple times)
      const duplicateReads: string[] = [];
      actions = actions.filter(action => {
        if (action.type === 'read' && 'path' in action) {
          const path = (action as any).path;
          if (filesReadThisTurn.has(path)) {
            duplicateReads.push(path);
            return false; // Skip duplicate
          }
          filesReadThisTurn.add(path);
        }
        return true;
      });

      // If LLM keeps trying to read same files, inject correction and continue
      if (duplicateReads.length > 0) {
        duplicateReadCount += duplicateReads.length;
        if (duplicateReadCount >= MAX_DUPLICATE_READS) {
          // Inject strong correction and let LLM continue with what it has
          this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
          });
          this.conversationHistory.push({
            role: 'user',
            content: `ERROR: You've already read these files - the content is in your context above. DO NOT read them again. Use the content you already have and complete the task. If you need to edit, use the exact text from your previous read.`,
          });
          continue; // Let LLM try again with the correction
        }
      }

      // Check for action tags inside code blocks (LLM mistake) - silently retry
      if (actions.length === 0) {
        const actionTagRegex = /<(bash|read|edit|write|glob|grep|explore)\b[^>]*>/gi;
        const foundTags = responseContent.match(actionTagRegex);
        if (foundTags && foundTags.length > 0) {
          // Check if tags are inside code blocks (backticks)
          const inCodeBlock = foundTags.some(tag => {
            const tagIndex = responseContent.indexOf(tag);
            if (tagIndex === -1) return false;
            const before = responseContent.slice(Math.max(0, tagIndex - 50), tagIndex);
            const after = responseContent.slice(tagIndex + tag.length, tagIndex + tag.length + 10);
            return (before.includes('`') && after.includes('`')) || before.includes('```');
          });

          if (inCodeBlock) {
            // Silently retry - LLM put tags in code blocks
            this.conversationHistory.push({
              role: 'assistant',
              content: responseContent,
            });
            this.conversationHistory.push({
              role: 'user',
              content:
                'ERROR: Action tag inside code block. Write action tags directly WITHOUT backticks.',
            });
            continue;
          }
        }
      }

      const actionResults = await executeActions(actions, this.actionHandlers);

      // If no actions were executed, check if LLM is hallucinating code instead of using actions
      if (actionResults.length === 0) {
        // Detect if model produced thinking but no actual content (reasoning model edge case)
        if (thinkingContent && !responseContent.trim()) {
          emptyResponseRetries++;
          if (emptyResponseRetries >= MAX_EMPTY_RETRIES) {
            // Give up after max retries
            console.log(c.warning('[Model not producing responses after retries]'));
            break;
          }
          // Model was thinking but didn't produce output - prompt to continue
          this.conversationHistory.push({
            role: 'assistant',
            content: '[Thinking...]',
          });
          this.conversationHistory.push({
            role: 'user',
            content: 'You were thinking but didn\'t provide a response. Please respond to the task.',
          });
          continue;
        }

        // Detect if response looks like code output (common LLM hallucination after failed search)
        const codePatterns = [
          /^(async\s+)?(function|class|const|let|var|export|import)\s+/m,
          /constructor\s*\([^)]*\)\s*\{/m,
          /^\s*(public|private|protected)\s+/m,
        ];
        const looksLikeCode = codePatterns.some(p => p.test(responseContent));

        // If LLM outputted code without action tags, it's likely hallucinating - prompt correction
        if (looksLikeCode && !responseContent.includes('```')) {
          this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
          });
          this.conversationHistory.push({
            role: 'user',
            content: `ERROR: You outputted code directly instead of using actions. NEVER output raw code - always use <read path="..."/> to check actual file content, or <edit path="...">...</edit> to make changes. Do NOT hallucinate file contents from memory.`,
          });
          continue;
        }
        break;
      }

      // Feed compressed results back to continue the conversation
      const compressedResults = compressActionResults(actionResults);

      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });
      // Build continuation prompt - be directive to keep LLM working
      const hasErrors = actionResults.some(r => !r.success);
      let continuationPrompt: string;

      if (hasErrors) {
        // Generic error handling - let LLM figure out the appropriate fix
        continuationPrompt = `${compressedResults}\n\n<system-instruction>ERROR DETECTED - You MUST fix it now. Read the action output above to find the file and line number, then use <read> and <edit> to fix it. Run the appropriate check command via bash to verify. Do NOT stop until the error is resolved.</system-instruction>`;
      } else {
        continuationPrompt = `${compressedResults}\n\n<system-instruction>Continue with the next step.</system-instruction>`;
      }

      this.conversationHistory.push({
        role: 'user',
        content: continuationPrompt,
      });
    }

    // Store final response in history (if not already added by action loop)
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
    if (lastMessage?.role !== 'assistant' || lastMessage?.content !== finalResponse) {
      this.conversationHistory.push({
        role: 'assistant',
        content: finalResponse,
      });
    }

    // Clean and return final response (remove action tags and internal monologue)
    const cleanResponse = cleanSelfDialogue(cleanXmlTags(finalResponse));

    return {
      response: cleanResponse,
      thinking: finalThinking,
    };
  }

  private async streamResponse(): Promise<{ content: string; thinking: string }> {
    const now = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    console.log();
    const requestBody = {
      model: this.getModel(),
      messages: this.conversationHistory,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    let responseContent = '';
    let thinkingContent = '';
    let displayedContent = '';
    let buffer = '';
    const thinking = new ThinkingAnimation();
    this.currentThinking = thinking;
    let firstChunk = true;
    let thinkingStreamStarted = false;

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Start thinking animation and thinking display stream
    thinking.start('Thinking...', this.workDir);
    thinkingDisplay.startStream();

    // Set up keyboard listener during streaming for Ctrl+O (toggle thinking) and Ctrl+C (abort)
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }
    const keyHandler = (data: Buffer) => {
      const key = data.toString();
      if (key === '\x0f') {
        // Ctrl+O - toggle thinking display
        thinkingDisplay.toggle();
      } else if (key === '\x03') {
        // Ctrl+C - abort request
        this.abortController?.abort();
      }
    };
    process.stdin.on('data', keyHandler);

    // Track request
    this.usage.requests++;

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
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
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content;

            // Track usage if provided
            if (parsed.usage) {
              this.usage.promptTokens += parsed.usage.prompt_tokens || 0;
              this.usage.completionTokens += parsed.usage.completion_tokens || 0;
              this.usage.totalTokens += parsed.usage.total_tokens || 0;
            }

            // Capture reasoning/thinking content from reasoning models
            if (delta?.reasoning_content) {
              // Stop spinner on first thinking chunk only if thinking display is visible (so it doesn't conflict)
              if (!thinkingStreamStarted && this.currentThinking && thinkingDisplay.isVisible()) {
                thinking.stop();
                this.currentThinking = null;
                thinkingStreamStarted = true;
              }
              thinkingContent += delta.reasoning_content;
              // Stream thinking content in real-time
              thinkingDisplay.streamChunk(delta.reasoning_content);
            }

            if (content) {
              responseContent += content;

              // Stream clean content (without XML action tags) to console
              // But wait if we're in the middle of an action tag or thinking block (incomplete <...>)
              const openTags = (
                responseContent.match(
                  /<(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|schedule|notify|skill|skill-install|plan|task|explore|ps|kill|telegram-config|discord-config|think|thinking|reasoning)\b/gi,
                ) || []
              ).length;
              const closeTags = (
                responseContent.match(
                  /<\/(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|schedule|notify|skill|skill-install|plan|task|explore|ps|kill|telegram-config|discord-config|think|thinking|reasoning)>|\/>/gi,
                ) || []
              ).length;
              const hasUnclosedTag = openTags > closeTags;

              // Also check for potential partial tag at end (e.g., "<" or "<re" that might become "<read")
              const partialTagMatch = responseContent.match(/<[a-z-]*$/i);
              const hasPartialTag = partialTagMatch !== null;

              if (!hasUnclosedTag && !hasPartialTag) {
                // Clean action tags and internal monologue/thinking
                const cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
                // Collapse multiple consecutive newlines to max 2
                const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
                const newContent = normalized.slice(displayedContent.length);
                if (newContent) {
                  // Stop thinking animation and close thinking box when content arrives
                  if (firstChunk) {
                    // Stop spinner if still running
                    if (this.currentThinking) {
                      thinking.stop();
                      this.currentThinking = null;
                    }
                    // Close thinking box before showing response
                    thinkingDisplay.endStream();
                    // Add newline and white bullet for response
                    process.stdout.write(`\n${colors.white}●${colors.reset} `);
                    firstChunk = false;
                  }
                  process.stdout.write(newContent);
                  displayedContent = normalized;
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      // Clean up keyboard listener
      process.stdin.off('data', keyHandler);
      if (process.stdin.isTTY && !wasRaw) {
        process.stdin.setRawMode(false);
      }

      // Stop thinking animation if still running (no content received)
      if (this.currentThinking) {
        const duration = thinking.stop();
        this.currentThinking = null;
        // End thinking stream first, then show duration
        if (thinkingDisplay.isStreaming()) {
          thinkingDisplay.endStream();
        }
        process.stdout.write(`\n${colors.muted}${duration}${colors.reset}`);
      } else if (thinkingDisplay.isStreaming()) {
        // Edge case: thinking stream still active but animation already stopped
        thinkingDisplay.endStream();
      }
      this.abortController = null;
    }

    // Output any remaining content that was buffered
    const cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
    const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
    const remainingContent = normalized.slice(displayedContent.length);
    if (remainingContent) {
      // Add bullet if this is the first content being displayed
      if (firstChunk) {
        process.stdout.write(`\n${colors.white}●${colors.reset} `);
        firstChunk = false;
      }
      process.stdout.write(remainingContent);
      displayedContent = normalized;
    }

    // Always add newline after streaming (ensures spacing before actions)
    process.stdout.write('\n');

    // Detect edge case: thinking content but no actual response
    // This can happen with reasoning models that think but don't generate output
    if (thinkingContent && !responseContent.trim()) {
      console.log(c.warning('[Model produced thinking but no response - may need to retry]'));
    }

    return { content: responseContent, thinking: thinkingContent };
  }

  clearHistory(): void {
    this.conversationHistory = [this.conversationHistory[0]];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  // Context compression methods
  setContextCompression(enabled: boolean, maxMessages?: number): void {
    this.contextCompressionEnabled = enabled;
    if (maxMessages) this.maxContextMessages = maxMessages;
  }

  isContextCompressionEnabled(): boolean {
    return this.contextCompressionEnabled;
  }

  getMaxContextMessages(): number {
    return this.maxContextMessages;
  }

  private compressContext(): void {
    if (!this.contextCompressionEnabled) return;

    // Keep system prompt + last N messages
    const systemPrompt = this.conversationHistory[0];
    const messages = this.conversationHistory.slice(1);

    if (messages.length <= this.maxContextMessages) return;

    // Keep only recent messages
    const recentMessages = messages.slice(-this.maxContextMessages);
    this.conversationHistory = [systemPrompt, ...recentMessages];

    console.log(
      c.muted(`[Context] Compressed: ${messages.length} → ${recentMessages.length} messages`),
    );
  }

  // Usage tracking methods
  getUsage(): UsageStats {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  }

  getContextSize(): number {
    return this.conversationHistory.length;
  }

  estimateTokens(): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(this.conversationHistory.reduce((sum, m) => sum + m.content.length, 0) / 4);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  }

  /**
   * Chat with action execution for Telegram/Discord - executes actions and returns summary
   * @param source - The platform source to adapt response style
   * @param timeout - Max time in ms (default: 120000 = 2 minutes)
   */
  async chatWithResponse(
    userMessage: string,
    source?: 'telegram' | 'discord',
    timeout: number = 120000,
  ): Promise<string> {
    const startTime = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // Add platform context hint
    const platformHint = source
      ? `\n[PLATFORM: ${source.toUpperCase()} - Execute actions, then respond with a 1-2 sentence SUMMARY in plain language. NEVER include code, file contents, or technical details. Describe what was done simply (e.g., "Fixed the login bug" not code snippets).]`
      : '';

    // Include recent images from imageBuffer (same as chat method)
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
      this.conversationHistory.push({
        role: 'user',
        content: userContent,
      });
    } else {
      this.conversationHistory.push({
        role: 'user',
        content: userMessage + platformHint,
      });
    }

    this.compressContext();

    const actionsSummary: string[] = [];
    let maxIterations = 15; // More iterations for multi-step tasks
    let finalResponse = '';

    // Track files read to prevent duplicate reads
    const filesReadThisTurn = new Set<string>();
    let duplicateReadCount = 0;

    // Agentic loop for actions
    while (maxIterations > 0) {
      maxIterations--;

      // Check timeout
      if (Date.now() - startTime > timeout) {
        const summary =
          actionsSummary.length > 0
            ? `Timeout after ${Math.round(timeout / 1000)}s. Completed: ${actionsSummary.join(', ')}`
            : `Timeout after ${Math.round(timeout / 1000)}s`;
        return summary;
      }

      const requestBody = {
        model: this.getModel(),
        messages: this.conversationHistory,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: false,
      };

      this.usage.requests++;

      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 60000);

      let response;
      try {
        response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      finalResponse = content;

      // Clear images after first API call (they've been sent, don't need image model anymore)
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Track usage
      if (data.usage) {
        this.usage.promptTokens += data.usage.prompt_tokens || 0;
        this.usage.completionTokens += data.usage.completion_tokens || 0;
        this.usage.totalTokens += data.usage.total_tokens || 0;
      }

      // Parse and execute actions
      let actions = parseActions(content);

      // Filter out duplicate read actions
      const duplicateReads: string[] = [];
      actions = actions.filter(action => {
        if (action.type === 'read' && 'path' in action) {
          const readPath = (action as any).path;
          if (filesReadThisTurn.has(readPath)) {
            duplicateReads.push(readPath);
            duplicateReadCount++;
            return false;
          }
          filesReadThisTurn.add(readPath);
        }
        return true;
      });

      // If too many duplicates, inject correction
      if (duplicateReadCount >= 3) {
        this.conversationHistory.push({
          role: 'assistant',
          content: content,
        });
        this.conversationHistory.push({
          role: 'user',
          content: `ERROR: Stop re-reading files. Use the content already in your context. Complete the task with what you have.`,
        });
        continue;
      }

      if (actions.length === 0) {
        // Detect if LLM is hallucinating code instead of using actions
        const codePatterns = [
          /^(async\s+)?(function|class|const|let|var|export|import)\s+/m,
          /constructor\s*\([^)]*\)\s*\{/m,
          /^\s*(public|private|protected)\s+/m,
        ];
        const looksLikeCode = codePatterns.some(p => p.test(content));

        if (looksLikeCode && !content.includes('```')) {
          this.conversationHistory.push({ role: 'assistant', content });
          this.conversationHistory.push({
            role: 'user',
            content: `ERROR: You outputted code directly instead of using actions. Use <read path="..."/> to check files, or <edit>...</edit> to make changes. Do NOT hallucinate file contents.`,
          });
          continue;
        }

        // No more actions, we're done
        this.conversationHistory.push({ role: 'assistant', content });
        break;
      }

      // Execute actions
      const actionResults = await executeActions(actions, this.actionHandlers);

      // Count errors and check for fail-fast
      const errorCount = actionResults.filter(r => !r.success).length;
      if (errorCount === actionResults.length && actionResults.length > 0) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const failedActions = actionResults.map(r => r.action).join(', ');
          return `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive failures. Last errors: ${failedActions}`;
        }
      } else {
        consecutiveErrors = 0;
      }

      // Collect summaries
      for (const r of actionResults) {
        const status = r.success ? '✓' : '✗';
        actionsSummary.push(`${status} ${r.action}`);
      }

      // Feed compressed results back
      const compressedResults = compressActionResults(actionResults);

      this.conversationHistory.push({ role: 'assistant', content });

      // Build continuation prompt - be directive to keep LLM working
      const hasErrors = actionResults.some(r => !r.success);
      let continuationPrompt: string;

      if (hasErrors) {
        // Generic error handling - let LLM figure out the appropriate fix
        continuationPrompt = `${compressedResults}\n\n<system-instruction>ERROR DETECTED - You MUST fix it now. Read the action output above to find the file and line number, then use <read> and <edit> to fix it. Run the appropriate check command via bash to verify. Do NOT stop until the error is resolved.</system-instruction>`;
      } else {
        continuationPrompt = `${compressedResults}\n\n<system-instruction>Continue with the next step.</system-instruction>`;
      }

      this.conversationHistory.push({
        role: 'user',
        content: continuationPrompt,
      });
    }

    // Return clean text (summary) or actions summary if response only had actions
    // Also clean self-dialogue patterns (internal monologue, repeated "Yes." etc.)
    const cleanResponse = cleanSelfDialogue(cleanXmlTags(finalResponse)).trim();

    if (cleanResponse) {
      return cleanResponse;
    } else if (actionsSummary.length > 0) {
      return `Done: ${actionsSummary.join(', ')}`;
    }
    return 'Done.';
  }

  /**
   * Chat with web search enabled using the /v1/responses endpoint
   * Uses X.AI's native web_search tool for real-time information
   */
  async searchChat(
    userMessage: string,
    options?: {
      enableXSearch?: boolean;
      allowedDomains?: string[];
      excludedDomains?: string[];
    },
  ): Promise<{ response: string; citations: string[] }> {
    const tools: Array<{ type: string; filters?: Record<string, any> }> = [{ type: 'web_search' }];

    // Add domain filters if specified
    if (options?.allowedDomains?.length) {
      tools[0].filters = { allowed_domains: options.allowedDomains.slice(0, 5) };
    } else if (options?.excludedDomains?.length) {
      tools[0].filters = { excluded_domains: options.excludedDomains.slice(0, 5) };
    }

    // Add X search if enabled
    if (options?.enableXSearch) {
      tools.push({ type: 'x_search' });
    }

    // Build input array (different format than chat/completions)
    const input = [
      { role: 'system', content: this.conversationHistory[0]?.content || SYSTEM_PROMPT },
      ...this.conversationHistory.slice(1).map(m => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : (m.content as any[]).find((p: any) => p.type === 'text')?.text || '',
      })),
      { role: 'user', content: userMessage },
    ];

    const requestBody = {
      model: 'grok-4-1-fast-reasoning',
      input,
      tools,
    };

    this.usage.requests++;

    const thinking = new ThinkingAnimation();
    this.currentThinking = thinking;
    thinking.start('Searching...', this.workDir);

    try {
      const response = await fetch(`${this.config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const duration = thinking.stop();
      this.currentThinking = null;
      console.log(`${colors.muted}${duration}${colors.reset}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok Search API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Extract response content from output array
      let content = '';
      if (Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            // Content is array of content blocks
            for (const block of item.content) {
              if (block.type === 'output_text' && block.text) {
                content += block.text;
              } else if (block.type === 'text' && block.text) {
                content += block.text;
              }
            }
          } else if (item.type === 'message' && typeof item.content === 'string') {
            content += item.content;
          }
        }
      }
      // Fallback to output_text if available
      if (!content && data.output_text) {
        content = data.output_text;
      }
      const citations = Array.isArray(data.citations) ? data.citations : [];

      // Track usage if available
      if (data.usage) {
        this.usage.promptTokens += data.usage.input_tokens || 0;
        this.usage.completionTokens += data.usage.output_tokens || 0;
        this.usage.totalTokens += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
      }

      // Add to conversation history (as simple strings for compatibility)
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: content });

      return {
        response: content,
        citations,
      };
    } catch (error) {
      thinking.stop(); // Ignore duration on error
      this.currentThinking = null;
      throw error;
    }
  }
}

export function createGrokClient(apiKey?: string): GrokClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new GrokClient({ apiKey: key });
}
