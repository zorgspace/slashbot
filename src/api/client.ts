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

/**
 * Simple LRU cache with max entries - evicts oldest on overflow
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this.cache;
  }
}

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
  // Persistent file content cache - keeps important files in context across turns (LRU, max 50 entries)
  private fileContextCache = new LRUCache<string, string>(50);
  // Track displayed content across agentic loop iterations to prevent duplicates
  private sessionDisplayedContent: string = '';

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
    // Reset session displayed content for new chat
    this.sessionDisplayedContent = '';

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

    // Track ALL executed actions for response validation
    const executedActions: Array<{ type: string; description: string; success: boolean }> = [];

    let emptyResponseRetries = 0;
    const MAX_EMPTY_RETRIES = 2; // Max retries when model produces thinking but no content
    let forcedRetryAttempted = false; // Track if we already tried the CRITICAL prompt

    // Agentic loop: execute actions and feed results back (no iteration limit)
    while (true) {
      let responseContent: string;
      let thinkingContent: string;
      try {
        const result = await this.streamResponse();
        responseContent = result.content;
        thinkingContent = result.thinking;
      } catch (error: any) {
        // Check if it's a token limit error
        if (error.message && error.message.includes("maximum prompt length")) {
          console.log(`\n${c.warning('[Token limit reached]')} Creating condensed context and coming back fresh...`);

          // Create condensed summary of entire conversation
          const condensedSummary = this.condenseHistory();
          console.log(c.muted(`[Context] Condensed ${this.conversationHistory.length} messages into 1 summary`));

          // Start fresh with condensed context
          this.conversationHistory = [
            this.conversationHistory[0], // Keep system prompt
            { role: 'user', content: condensedSummary }
          ];

          // Retry with condensed context
          try {
            const result = await this.streamResponse();
            responseContent = result.content;
            thinkingContent = result.thinking;
          } catch (retryError: any) {
            console.error(`\n${c.error('[API Error after condensation]')} ${retryError.message || retryError}`);
            throw retryError;
          }
        } else {
          console.error(`\n${c.error('[API Error]')} ${error.message || error}`);
          throw error;
        }
      }
      finalResponse = responseContent;
      finalThinking += thinkingContent;

      // Clear images after first API call (they've been sent, don't need image model anymore)
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Execute actions and collect results
      let actions = parseActions(responseContent);

      // DEBUG: Show FULL raw response if edit tag detected but not parsed
      const editTagMatch = responseContent.match(/<edit[^>]*>|<\/edit>/gi);
      const hasEditTags = editTagMatch && editTagMatch.length > 0;
      const hasEditAction = actions.some(a => a.type === 'edit' || a.type === 'multi-edit');
      if (hasEditTags && !hasEditAction) {
        console.log('\n' + c.warning('[DEBUG] Edit tag detected but not parsed:'));
        console.log(c.muted('--- Raw response containing edit tags (FULL) ---'));
        // Find and show the FULL edit portion - no truncation
        const editStart = responseContent.indexOf('<edit');
        const editEnd = responseContent.lastIndexOf('</edit>');
        if (editStart !== -1 && editEnd !== -1) {
          const editPortion = responseContent.slice(editStart, editEnd + 7);
          console.log(editPortion); // Full content, no truncation
        } else {
          console.log(responseContent); // Full content, no truncation
        }
        console.log(c.muted('--- End debug ---'));
      }

      // NOTE: Duplicate reads are allowed - LLM may need to re-read files if context is lost
      // We don't filter or block duplicate reads anymore

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

      // Check if a say action was executed - this signals task completion
      // The LLM has presented results and is ready for user interaction
      const hasSayAction = actionResults.some(r => r.action === 'Say');
      if (hasSayAction) {
        // Store the assistant response before breaking
        this.conversationHistory.push({
          role: 'assistant',
          content: responseContent,
        });
        break;
      }

      // Track executed actions for response validation
      // Also cache file contents for persistent context
      for (const result of actionResults) {
        executedActions.push({
          type: result.action.split('(')[0].trim(), // e.g., "bash" from "bash(git push)"
          description: result.action,
          success: result.success,
        });

        // Cache file read results for persistent context
        if (result.action.startsWith('Read:') && result.success && result.result) {
          const filePath = result.action.replace('Read: ', '').trim();
          // Only cache files under 50KB to avoid memory issues
          if (result.result.length < 50000) {
            this.fileContextCache.set(filePath, result.result);
          }
        }
        // Update cache when file is edited - re-read to get new content
        if ((result.action.startsWith('Edit:') || result.action.startsWith('MultiEdit:')) && result.success && this.actionHandlers.onRead) {
          const filePath = result.action.replace(/^(Edit|MultiEdit): /, '').trim();
          try {
            const newContent = await this.actionHandlers.onRead(filePath);
            if (newContent && newContent.length < 50000) {
              this.fileContextCache.set(filePath, newContent);
            }
          } catch {
            // Ignore read errors, cache will be stale
          }
        }
        // Update cache when file is written
        if (result.action.startsWith('Write:') && result.success && this.actionHandlers.onRead) {
          const filePath = result.action.replace('Write: ', '').trim();
          try {
            const newContent = await this.actionHandlers.onRead(filePath);
            if (newContent && newContent.length < 50000) {
              this.fileContextCache.set(filePath, newContent);
            }
          } catch {
            // Ignore read errors
          }
        }
        // Cache grep results too
        if (result.action.startsWith('Grep:') && result.success && result.result) {
          const grepKey = `grep:${result.action}`;
          if (result.result.length < 50000) {
            this.fileContextCache.set(grepKey, result.result);
          }
        }
      }

      // If no actions were executed, check if LLM is hallucinating code instead of using actions
      if (actionResults.length === 0) {
        // Detect if model produced thinking but no actual content (reasoning model edge case)
        if (thinkingContent && !responseContent.trim()) {
          emptyResponseRetries++;
          if (emptyResponseRetries >= MAX_EMPTY_RETRIES) {
            if (forcedRetryAttempted) {
              // Already tried the CRITICAL prompt, give up
              console.log('\n' + c.error('[Model failed to respond after forced retry - stopping]'));
              break;
            }
            // Give up after max retries - provide clear feedback
            console.log('\n' + c.warning('[Model stopped producing responses after retries]'));
            console.log(c.muted('Last thinking: ' + thinkingContent));
            // Force a final response by asking directly
            this.conversationHistory.push({
              role: 'assistant',
              content: '[Incomplete - model stopped responding]',
            });
            this.conversationHistory.push({
              role: 'user',
              content: 'CRITICAL: You stopped mid-task. Your last thought was: ' + thinkingContent + '. Execute that action NOW or explain what went wrong.',
            });
            forcedRetryAttempted = true;
            continue;
          }
          // Model was thinking but didn't produce output - prompt to continue
          this.conversationHistory.push({
            role: 'assistant',
            content: '[Thinking...]',
          });
          this.conversationHistory.push({
            role: 'user',
            content: 'You were thinking but didn\'t provide a response. Execute your planned action NOW.',
          });
          continue;
        }

        // Detect malformed edit: has </edit> but missing proper <edit path="..."><search>
        const hasCloseEdit = /<\/edit/i.test(responseContent);
        const hasProperEditOpen = /<edit\s+path=["'][^"']+["'][^>]*>\s*<search>/i.test(responseContent);
        if (hasCloseEdit && !hasProperEditOpen) {
          this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
          });
          this.conversationHistory.push({
            role: 'user',
            content: `ERROR: Malformed edit tag. You must use the EXACT format:\n<edit path="file.ts"><search>old code</search><replace>new code</replace></edit>\n\nYou cannot just output code with </edit at the end. Include the full structure.`,
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

      // Reset retry counters on successful action execution
      emptyResponseRetries = 0;
      forcedRetryAttempted = false;

      // Feed compressed results back to continue the conversation
      const compressedResults = compressActionResults(actionResults);

      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });

      // Build file context from cache (include all cached files for persistent context)
      let fileContext = '';
      if (this.fileContextCache.size > 0) {
        // List of filenames first for quick reference
        const filenames = Array.from(this.fileContextCache.keys()).filter(k => !k.startsWith('grep:'));
        const filenameList = filenames.length > 0 ? `Files in context: ${filenames.join(', ')}\n\n` : '';

        const fileEntries: string[] = [];
        for (const [key, content] of this.fileContextCache) {
          if (key.startsWith('grep:')) {
            fileEntries.push(`[${key}]\n${content}`);
          } else {
            fileEntries.push(`[File: ${key}]\n${content}`);
          }
        }
        fileContext = `\n\n<file-context>\n${filenameList}${fileEntries.join('\n\n---\n\n')}\n</file-context>`;
      }

      // Build continuation prompt with running action tally - LLM knows what's been done
      const hasErrors = actionResults.some(r => !r.success);
      const actionTally = executedActions
        .map(a => `${a.success ? '✓' : '✗'} ${a.description}`)
        .join('\n');
      let continuationPrompt: string;

      if (hasErrors) {
        continuationPrompt = `${compressedResults}${fileContext}\n\n<session-actions>\n${actionTally}\n</session-actions>\n\n<system-instruction>ERROR DETECTED - fix it now. File contents are in <file-context> above.</system-instruction>`;
      } else {
        continuationPrompt = `${compressedResults}${fileContext}\n\n<session-actions>\n${actionTally}\n</session-actions>\n\n<system-instruction>Continue or finish with <say>. If the task is complete or you need user input, use <say> to present a summary and ask for the next steps. File contents are in <file-context> above. Only claim actions that appear in session-actions.</system-instruction>`;
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

    // Inject executed actions into context so LLM is aware of what was actually done
    // This ensures the final response accurately reflects reality
    if (executedActions.length > 0) {
      const actionSummary = executedActions
        .map(a => `- ${a.success ? '✓' : '✗'} ${a.description}`)
        .join('\n');

      // Add action summary to conversation for future context
      this.conversationHistory.push({
        role: 'user',
        content: `<session-actions>\n${actionSummary}\n</session-actions>`,
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
                let cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
                // Remove "Assistant:" prefixes that LLM might generate
                cleanFull = cleanFull.replace(/^Assistant:\s*/gim, '');
                // Collapse multiple consecutive newlines to max 2
                const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
                // Use session-level tracking to prevent duplicates across loop iterations
                const newContent = normalized.slice(this.sessionDisplayedContent.length);
                if (newContent && newContent.trim()) {
                  // Check if this content was already displayed (deduplication)
                  const isDuplicate = this.sessionDisplayedContent.includes(newContent.trim());
                  if (!isDuplicate) {
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
                    this.sessionDisplayedContent = normalized;
                  }
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
    let cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
    cleanFull = cleanFull.replace(/^Assistant:\s*/gim, '');
    const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
    const remainingContent = normalized.slice(this.sessionDisplayedContent.length);
    if (remainingContent && remainingContent.trim()) {
      const isDuplicate = this.sessionDisplayedContent.includes(remainingContent.trim());
      if (!isDuplicate) {
        // Add bullet if this is the first content being displayed
        if (firstChunk) {
          process.stdout.write(`\n${colors.white}●${colors.reset} `);
          firstChunk = false;
        }
        process.stdout.write(remainingContent);
        this.sessionDisplayedContent = normalized;
      }
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
    this.fileContextCache.clear();
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

  private condenseHistory(): string {
    const messages = this.conversationHistory.slice(1); // Skip system prompt
    let summary = 'Conversation Summary:\n';

    // Extract user messages and key actions
    const userMessages: string[] = [];
    const actions: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = typeof msg.content === 'string' ? msg.content : msg.content?.[0]?.text || '';
        if (content && !content.includes('<session-actions>') && !content.includes('<system-instruction>')) {
          userMessages.push(content.split('\n')[0]); // First line only
        }
      } else if (msg.role === 'assistant') {
        // Look for actions in assistant responses
        const actionMatches = (msg.content as string).match(/<(bash|read|edit|write|grep|explore)\b[^>]*>/g);
        if (actionMatches) {
          actions.push(...actionMatches.slice(0, 3)); // Limit actions
        }
      }
    }

    if (userMessages.length > 0) {
      summary += `User requests: ${userMessages.slice(-5).join('; ')}\n`; // Last 5 user messages
    }

    if (actions.length > 0) {
      summary += `Actions performed: ${actions.slice(-5).join(', ')}\n`; // Last 5 actions
    }

    summary += `Total messages: ${messages.length}\n`;
    summary += 'Please continue from this point.';

    return summary;
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
   * Chat with action execution for Telegram/Discord - streams thinking and actions to CLI
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
    let maxIterations = 15;
    let finalResponse = '';
    let isFirstIteration = true;

    // Agentic loop for actions
    while (maxIterations > 0) {
      maxIterations--;

      // Check timeout
      if (Date.now() - startTime > timeout) {
        thinkingDisplay.endStream();
        const summary =
          actionsSummary.length > 0
            ? `Timeout after ${Math.round(timeout / 1000)}s. Completed: ${actionsSummary.join(', ')}`
            : `Timeout after ${Math.round(timeout / 1000)}s`;
        return summary;
      }

      // Stream response with thinking display
      const { content, thinking: thinkingContent } = await this.streamConnectorResponse(isFirstIteration);
      isFirstIteration = false;
      finalResponse = content;

      // Clear images after first API call
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Parse and execute actions
      const actions = parseActions(content);

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

      // Execute actions and display each one
      const actionResults = await executeActions(actions, this.actionHandlers);

      // Display action results
      for (const r of actionResults) {
        const icon = r.success ? `${colors.success}✓${colors.reset}` : `${colors.error}✗${colors.reset}`;
        process.stdout.write(`${colors.muted}│${colors.reset} ${icon} ${r.action}\n`);
      }

      // Check if a say action was executed - this signals task completion
      const hasSayAction = actionResults.some(r => r.action === 'Say');
      if (hasSayAction) {
        this.conversationHistory.push({ role: 'assistant', content });
        const sayResult = actionResults.find(r => r.action === 'Say');
        // Display the final response with bullet
        const sayMessage = sayResult?.result || 'Done.';
        process.stdout.write(`\n${colors.white}●${colors.reset} ${sayMessage}\n`);
        return sayMessage;
      }

      // Count errors and check for fail-fast
      const errorCount = actionResults.filter(r => !r.success).length;
      if (errorCount === actionResults.length && actionResults.length > 0) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const failedActions = actionResults.map(r => r.action).join(', ');
          const errorMsg = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive failures. Last errors: ${failedActions}`;
          process.stdout.write(`\n${colors.error}●${colors.reset} ${errorMsg}\n`);
          return errorMsg;
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

      const hasErrors = actionResults.some(r => !r.success);
      const actionTally = actionsSummary.join('\n');
      let continuationPrompt: string;

      if (hasErrors) {
        continuationPrompt = `${compressedResults}\n\n<session-actions>\n${actionTally}\n</session-actions>\n\n<system-instruction>ERROR DETECTED - fix it now.</system-instruction>`;
      } else {
        continuationPrompt = `${compressedResults}\n\n<session-actions>\n${actionTally}\n</session-actions>\n\n<system-instruction>Continue or finish with <say>. If the task is complete or you need user input, use <say> to present a summary. Only claim actions that appear in session-actions.</system-instruction>`;
      }

      this.conversationHistory.push({
        role: 'user',
        content: continuationPrompt,
      });
    }

    // Return clean text or actions summary
    const cleanResponse = cleanSelfDialogue(cleanXmlTags(finalResponse)).trim();

    if (cleanResponse) {
      process.stdout.write(`\n${colors.white}●${colors.reset} ${cleanResponse}\n`);
      return cleanResponse;
    } else if (actionsSummary.length > 0) {
      const summary = `Done: ${actionsSummary.join(', ')}`;
      process.stdout.write(`\n${colors.white}●${colors.reset} ${summary}\n`);
      return summary;
    }
    process.stdout.write(`\n${colors.white}●${colors.reset} Done.\n`);
    return 'Done.';
  }

  /**
   * Stream response for connector with thinking display
   */
  private async streamConnectorResponse(showThinking: boolean): Promise<{ content: string; thinking: string }> {
    const requestBody = {
      model: this.getModel(),
      messages: this.conversationHistory,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    let responseContent = '';
    let thinkingContent = '';
    let buffer = '';
    const thinking = new ThinkingAnimation();
    let thinkingStreamStarted = false;

    // Start thinking animation and display
    if (showThinking) {
      thinking.start('Thinking...');
      thinkingDisplay.startStream();
    }

    this.usage.requests++;

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
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

            // Track usage
            if (parsed.usage) {
              this.usage.promptTokens += parsed.usage.prompt_tokens || 0;
              this.usage.completionTokens += parsed.usage.completion_tokens || 0;
              this.usage.totalTokens += parsed.usage.total_tokens || 0;
            }

            // Capture thinking content and stream to display
            if (delta?.reasoning_content && showThinking) {
              if (!thinkingStreamStarted && thinkingDisplay.isVisible()) {
                thinking.stop();
                thinkingStreamStarted = true;
              }
              thinkingContent += delta.reasoning_content;
              thinkingDisplay.streamChunk(delta.reasoning_content);
            }

            if (content) {
              responseContent += content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      clearTimeout(fetchTimeout);

      // Stop thinking animation and close display
      if (showThinking) {
        if (!thinkingStreamStarted) {
          thinking.stop();
        }
        if (thinkingDisplay.isStreaming()) {
          thinkingDisplay.endStream();
        }
      }
    }

    return { content: responseContent, thinking: thinkingContent };
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
